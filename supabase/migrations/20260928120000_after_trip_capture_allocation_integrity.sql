-- Bind normal security-deposit captures to approved itemized After-Trip charges.
-- Stripe calls remain in the Edge Function; these functions only validate and persist ZONYX records.

CREATE TABLE public.after_trip_capture_attempts (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  payment_intent_id text NOT NULL,
  requested_allocations jsonb NOT NULL,
  requested_total_cents bigint NOT NULL CHECK(requested_total_cents>0),
  allocation_fingerprint text NOT NULL CHECK(allocation_fingerprint~'^[a-f0-9]{32}$'),
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','finalized')),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  source_ledger_entry_id uuid REFERENCES public.booking_financial_ledger(id) ON DELETE RESTRICT,
  reconciliation_id uuid REFERENCES public.after_trip_reconciliations(id) ON DELETE RESTRICT,
  UNIQUE(booking_id,allocation_fingerprint)
);
ALTER TABLE public.after_trip_capture_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.after_trip_capture_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.after_trip_capture_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_after_trip_deposit_capture(
  _attempt_id uuid,_booking_id uuid,_allocations jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; actor uuid; normalized jsonb='[]'::jsonb; item jsonb; c public.after_trip_charges%ROWTYPE; amount bigint; settled bigint; total bigint=0; fingerprint text; existing public.after_trip_capture_attempts%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 actor:=public.current_profile_id();
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
 IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required for deposit capture.'; END IF;
 IF b.trip_status NOT IN('pending_inspection','completed') THEN RAISE EXCEPTION 'Deposit capture requires a returned or completed trip.'; END IF;
 IF b.authorization_hold_payment_intent_id IS NULL THEN RAISE EXCEPTION 'No security-deposit authorization exists for this booking.'; END IF;
 IF jsonb_typeof(_allocations)<>'array' OR jsonb_array_length(_allocations)=0 OR jsonb_array_length(_allocations)>20 THEN RAISE EXCEPTION 'One to twenty itemized charge allocations are required.'; END IF;
 IF (SELECT count(*)<>count(DISTINCT value->>'charge_id') FROM jsonb_array_elements(_allocations)) THEN RAISE EXCEPTION 'Each itemized charge may appear only once.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_allocations) LOOP
  BEGIN amount:=(item->>'amount_cents')::bigint; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Every allocation must use integer cents.'; END;
  IF amount<=0 THEN RAISE EXCEPTION 'Every allocation must be greater than zero.'; END IF;
  SELECT * INTO c FROM public.after_trip_charges WHERE id=(item->>'charge_id')::uuid AND booking_id=b.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Every itemized charge must belong to this booking.'; END IF;
  IF c.status NOT IN('submitted','pending_payment') THEN RAISE EXCEPTION 'Only eligible undisputed itemized charges may be captured.'; END IF;
  SELECT COALESCE(sum(s.amount_cents),0) INTO settled FROM public.after_trip_charge_settlements s WHERE s.charge_id=c.id AND s.status='proven';
  IF amount>c.amount_cents-settled THEN RAISE EXCEPTION 'Requested capture exceeds the remaining eligible itemized charges.'; END IF;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('charge_id',c.id,'amount_cents',amount,'category',c.category,'explanation',c.explanation)); total:=total+amount;
 END LOOP;
 fingerprint:=md5(jsonb_build_object('booking_id',b.id,'payment_intent_id',b.authorization_hold_payment_intent_id,'allocations',normalized)::text);
 SELECT * INTO existing FROM public.after_trip_capture_attempts WHERE id=_attempt_id OR(booking_id=b.id AND allocation_fingerprint=fingerprint) ORDER BY created_at LIMIT 1;
 IF FOUND THEN
  IF existing.booking_id<>b.id OR existing.payment_intent_id<>b.authorization_hold_payment_intent_id OR existing.requested_allocations<>normalized OR existing.requested_total_cents<>total THEN RAISE EXCEPTION 'Capture attempt idempotency conflict.'; END IF;
  RETURN jsonb_build_object('attempt_id',existing.id,'booking_id',b.id,'payment_intent_id',existing.payment_intent_id,'allocations',existing.requested_allocations,'total_cents',existing.requested_total_cents,'status',existing.status,'already_finalized',existing.status='finalized');
 END IF;
 INSERT INTO public.after_trip_capture_attempts(id,booking_id,payment_intent_id,requested_allocations,requested_total_cents,allocation_fingerprint,created_by_profile_id)
 VALUES(_attempt_id,b.id,b.authorization_hold_payment_intent_id,normalized,total,fingerprint,actor);
 RETURN jsonb_build_object('attempt_id',_attempt_id,'booking_id',b.id,'payment_intent_id',b.authorization_hold_payment_intent_id,'allocations',normalized,'total_cents',total,'status','prepared','already_finalized',false);
END $$;
REVOKE ALL ON FUNCTION public.prepare_after_trip_deposit_capture(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_after_trip_deposit_capture(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_after_trip_deposit_capture(
 _attempt_id uuid,_payment_intent_id text,_captured_amount_cents bigint,_charge_id text,_occurred_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE attempt public.after_trip_capture_attempts%ROWTYPE; b public.bookings%ROWTYPE; item jsonb; c public.after_trip_charges%ROWTYPE; already bigint; ledger_id uuid; reconciliation uuid; settlement_id uuid; actor uuid; ordinal int=0;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO attempt FROM public.after_trip_capture_attempts WHERE id=_attempt_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prepared capture attempt not found.'; END IF;
 IF attempt.status='finalized' THEN RETURN jsonb_build_object('attempt_id',attempt.id,'status','finalized','source_ledger_entry_id',attempt.source_ledger_entry_id,'reconciliation_id',attempt.reconciliation_id,'already_finalized',true); END IF;
 IF attempt.payment_intent_id<>_payment_intent_id OR attempt.requested_total_cents<>_captured_amount_cents THEN RAISE EXCEPTION 'Stripe capture evidence does not match the prepared itemized total.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=attempt.booking_id FOR UPDATE; actor:=attempt.created_by_profile_id;
 SELECT id INTO ledger_id FROM public.booking_financial_ledger WHERE booking_id=b.id AND stable_key='deposit-capture:'||_payment_intent_id;
 IF ledger_id IS NULL THEN
  INSERT INTO public.booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
  VALUES(b.id,NULL,'deposit-capture:'||_payment_intent_id,'deposit_capture','security_deposit',_captured_amount_cents,b.currency,'deposit_capture','succeeded','stripe_capture',_payment_intent_id,'Stripe-proven security-deposit capture',COALESCE(_occurred_at,now()),actor,jsonb_build_object('charge_id',_charge_id,'capture_attempt_id',attempt.id)) RETURNING id INTO ledger_id;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.booking_financial_ledger WHERE id=ledger_id AND effect='deposit_capture' AND status='succeeded' AND amount_cents=_captured_amount_cents AND external_reference=_payment_intent_id) THEN RAISE EXCEPTION 'Existing capture ledger evidence conflicts with Stripe.'; END IF;
 END IF;
 INSERT INTO public.after_trip_reconciliations(booking_id,source_ledger_entry_id,idempotency_key,proposal_fingerprint,reason,proposed_charges,total_charge_cents,settlement_source,created_by_profile_id)
 VALUES(b.id,ledger_id,'normal-capture:'||attempt.id,attempt.allocation_fingerprint,'Automatic allocation from itemized After-Trip deposit capture',attempt.requested_allocations,attempt.requested_total_cents,'security_deposit',actor)
 ON CONFLICT(booking_id,idempotency_key) DO NOTHING RETURNING id INTO reconciliation;
 IF reconciliation IS NULL THEN SELECT id INTO reconciliation FROM public.after_trip_reconciliations WHERE booking_id=b.id AND idempotency_key='normal-capture:'||attempt.id; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(attempt.requested_allocations) LOOP
  ordinal:=ordinal+1; SELECT * INTO c FROM public.after_trip_charges WHERE id=(item->>'charge_id')::uuid AND booking_id=b.id FOR UPDATE;
  SELECT COALESCE(sum(amount_cents),0) INTO already FROM public.after_trip_charge_settlements WHERE charge_id=c.id AND status='proven';
  IF (item->>'amount_cents')::bigint>c.amount_cents-already THEN RAISE EXCEPTION 'Prepared allocation now exceeds the remaining charge balance.'; END IF;
  INSERT INTO public.after_trip_charge_settlements(booking_id,charge_id,source_ledger_entry_id,reconciliation_id,amount_cents,currency,settlement_source,idempotency_key,created_by_profile_id)
  VALUES(b.id,c.id,ledger_id,reconciliation,(item->>'amount_cents')::bigint,b.currency,'security_deposit','normal-capture:'||attempt.id||':'||ordinal,actor)
  ON CONFLICT(booking_id,idempotency_key) DO NOTHING RETURNING id INTO settlement_id;
  SELECT COALESCE(sum(amount_cents),0) INTO already FROM public.after_trip_charge_settlements WHERE charge_id=c.id AND status='proven';
  PERFORM set_config('app.after_trip_admin_transition','allowed',true);
  UPDATE public.after_trip_charges SET status=CASE WHEN already>=amount_cents THEN 'paid' ELSE 'pending_payment' END,payment_status=CASE WHEN already>=amount_cents THEN 'paid' ELSE 'pending' END,status_changed_at=now() WHERE id=c.id;
 END LOOP;
 UPDATE public.bookings SET authorization_hold_status='captured',authorization_hold_captured_amount_cents=_captured_amount_cents,authorization_hold_captured_at=COALESCE(_occurred_at,now()),updated_at=now() WHERE id=b.id;
 UPDATE public.after_trip_capture_attempts SET status='finalized',finalized_at=now(),source_ledger_entry_id=ledger_id,reconciliation_id=reconciliation WHERE id=attempt.id;
 INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,amount_cents,external_reference,actor_profile_id,actor_role)
 VALUES(b.id,'after_trip_deposit_capture_finalized','Automatic settlement from approved itemized After-Trip charges',jsonb_build_object('attempt_status','prepared'),jsonb_build_object('attempt_status','finalized','capture_attempt_id',attempt.id,'source_ledger_entry_id',ledger_id,'reconciliation_id',reconciliation,'allocations',attempt.requested_allocations),_captured_amount_cents,_payment_intent_id,actor,'admin');
 RETURN jsonb_build_object('attempt_id',attempt.id,'status','finalized','source_ledger_entry_id',ledger_id,'reconciliation_id',reconciliation,'already_finalized',false);
END $$;
REVOKE ALL ON FUNCTION public.finalize_after_trip_deposit_capture(uuid,text,bigint,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_after_trip_deposit_capture(uuid,text,bigint,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_after_trip_operations(_booking_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE charges_json jsonb; sources_json jsonb; unreconciled_json jsonb;
BEGIN
 IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('charge_id',c.id,'booking_id',c.booking_id,'reservation_number',b.reservation_number,'trip_status',b.trip_status,'vehicle',concat_ws(' ',v.brand,v.model),'guest_name',r.full_name,'guest_email',r.email,'host_name',h.full_name,'host_email',h.email,'category',c.category,'amount_cents',c.amount_cents,'currency',c.currency,'explanation',c.explanation,'charge_status',c.status,'submitted_at',c.submitted_at,'settled_amount_cents',COALESCE(s.settled,0),'remaining_amount_cents',GREATEST(0,c.amount_cents-COALESCE(s.settled,0)),'settlement_status',CASE WHEN c.status IN('waived','voided') THEN c.status WHEN COALESCE(s.settled,0)=0 THEN 'unpaid' WHEN COALESCE(s.settled,0)<c.amount_cents THEN 'partially_paid' ELSE 'paid' END) ORDER BY c.submitted_at DESC),'[]') INTO charges_json FROM public.after_trip_charges c JOIN public.bookings b ON b.id=c.booking_id JOIN public.vehicles v ON v.id=b.vehicle_id JOIN public.profiles r ON r.id=b.renter_profile_id JOIN public.profiles h ON h.id=b.host_profile_id LEFT JOIN LATERAL(SELECT sum(x.amount_cents) settled FROM public.after_trip_charge_settlements x WHERE x.charge_id=c.id AND x.status='proven')s ON true WHERE _booking_id IS NULL OR c.booking_id=_booking_id;
 WITH sources AS(SELECT l.*,COALESCE(used.allocated,0) allocated,COALESCE(ref.refunded,0) refunded,GREATEST(0,l.amount_cents-COALESCE(ref.refunded,0)-COALESCE(used.allocated,0)) available FROM public.booking_financial_ledger l LEFT JOIN LATERAL(SELECT sum(x.amount_cents) allocated FROM public.after_trip_charge_settlements x WHERE x.source_ledger_entry_id=l.id AND x.status='proven')used ON true LEFT JOIN LATERAL(SELECT sum(x.amount_cents) refunded FROM public.booking_financial_ledger x WHERE x.booking_id=l.booking_id AND x.effect IN('refund','deposit_refund') AND x.status='succeeded' AND x.external_reference IS NOT DISTINCT FROM l.external_reference)ref ON true WHERE(_booking_id IS NULL OR l.booking_id=_booking_id) AND l.status='succeeded' AND l.external_reference IS NOT NULL AND(l.effect='deposit_capture' OR(l.effect='payment' AND l.category='after_trip_payment')))
 SELECT COALESCE(jsonb_agg(jsonb_build_object('ledger_entry_id',s.id,'booking_id',s.booking_id,'source_type',CASE WHEN s.effect='deposit_capture' THEN 'security_deposit' ELSE 'separate_payment' END,'description',s.description,'external_reference',s.external_reference,'amount_cents',s.amount_cents,'refunded_cents',s.refunded,'allocated_cents',s.allocated,'available_cents',s.available,'currency',s.currency,'occurred_at',s.occurred_at) ORDER BY s.occurred_at),'[]') INTO sources_json FROM sources s;
 WITH sources AS(SELECT l.*,COALESCE(used.allocated,0) allocated,GREATEST(0,l.amount_cents-COALESCE(ref.refunded,0)-COALESCE(used.allocated,0)) available FROM public.booking_financial_ledger l LEFT JOIN LATERAL(SELECT sum(x.amount_cents) allocated FROM public.after_trip_charge_settlements x WHERE x.source_ledger_entry_id=l.id AND x.status='proven')used ON true LEFT JOIN LATERAL(SELECT sum(x.amount_cents) refunded FROM public.booking_financial_ledger x WHERE x.booking_id=l.booking_id AND x.effect IN('refund','deposit_refund') AND x.status='succeeded' AND x.external_reference IS NOT DISTINCT FROM l.external_reference)ref ON true WHERE(_booking_id IS NULL OR l.booking_id=_booking_id) AND l.status='succeeded' AND l.external_reference IS NOT NULL AND(l.effect='deposit_capture' OR(l.effect='payment' AND l.category='after_trip_payment')))
 SELECT COALESCE(jsonb_agg(jsonb_build_object('ledger_entry_id',s.id,'booking_id',b.id,'reservation_number',b.reservation_number,'trip_status',b.trip_status,'vehicle',concat_ws(' ',v.brand,v.model),'guest_name',r.full_name,'guest_email',r.email,'host_name',h.full_name,'host_email',h.email,'source_type',CASE WHEN s.effect='deposit_capture' THEN 'security_deposit' ELSE 'separate_payment' END,'description',s.description,'external_reference',s.external_reference,'amount_cents',s.amount_cents,'allocated_cents',s.allocated,'available_cents',s.available,'currency',s.currency,'occurred_at',s.occurred_at) ORDER BY s.occurred_at DESC),'[]') INTO unreconciled_json FROM sources s JOIN public.bookings b ON b.id=s.booking_id JOIN public.vehicles v ON v.id=b.vehicle_id JOIN public.profiles r ON r.id=b.renter_profile_id JOIN public.profiles h ON h.id=b.host_profile_id WHERE s.available>0;
 RETURN jsonb_build_object('charges',charges_json,'settlement_sources',sources_json,'unreconciled_sources',unreconciled_json,'observed_at',now(),'read_only',true);
END $$;
REVOKE ALL ON FUNCTION public.get_after_trip_operations(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_after_trip_operations(uuid) TO authenticated;