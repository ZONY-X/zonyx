-- Module 4D: immutable after-trip settlement allocations and Admin historical reconciliation.
-- This migration never calls Stripe and never creates financial evidence; settlements must
-- reference an existing succeeded payment/deposit-capture ledger entry.

ALTER TABLE public.after_trip_charges DROP CONSTRAINT after_trip_charges_category_check;
ALTER TABLE public.after_trip_charges ADD CONSTRAINT after_trip_charges_category_check CHECK (category IN (
  'tolls','excess_mileage','late_return','cleaning','damage','charging_energy',
  'parking_tickets_violations','administrative_fee','other'
));

CREATE TABLE public.after_trip_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  source_ledger_entry_id uuid NOT NULL REFERENCES public.booking_financial_ledger(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  proposal_fingerprint text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  proposed_charges jsonb NOT NULL,
  total_charge_cents bigint NOT NULL CHECK (total_charge_cents > 0),
  settlement_source text NOT NULL CHECK (settlement_source IN ('security_deposit','separate_payment')),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id,idempotency_key)
);

CREATE TABLE public.after_trip_charge_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  charge_id uuid NOT NULL REFERENCES public.after_trip_charges(id) ON DELETE RESTRICT,
  source_ledger_entry_id uuid NOT NULL REFERENCES public.booking_financial_ledger(id) ON DELETE RESTRICT,
  reconciliation_id uuid REFERENCES public.after_trip_reconciliations(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  settlement_source text NOT NULL CHECK (settlement_source IN ('security_deposit','separate_payment')),
  status text NOT NULL DEFAULT 'proven' CHECK (status='proven'),
  idempotency_key text NOT NULL,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id,idempotency_key)
);

CREATE INDEX after_trip_settlements_booking_idx ON public.after_trip_charge_settlements(booking_id,created_at);
ALTER TABLE public.after_trip_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.after_trip_charge_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "After trip reconciliations read admin" ON public.after_trip_reconciliations FOR SELECT USING (public.current_profile_is_admin());
CREATE POLICY "After trip settlements read participants" ON public.after_trip_charge_settlements FOR SELECT USING (
  EXISTS(SELECT 1 FROM public.bookings b WHERE b.id=booking_id AND (public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()))
);
REVOKE INSERT,UPDATE,DELETE ON public.after_trip_reconciliations,public.after_trip_charge_settlements FROM anon,authenticated;
GRANT SELECT ON public.after_trip_reconciliations,public.after_trip_charge_settlements TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_after_trip_settlement_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'After-trip reconciliation and settlement history is immutable.'; END; $$;
CREATE TRIGGER prevent_after_trip_reconciliation_mutation BEFORE UPDATE OR DELETE ON public.after_trip_reconciliations FOR EACH ROW EXECUTE FUNCTION public.prevent_after_trip_settlement_history_mutation();
CREATE TRIGGER prevent_after_trip_settlement_mutation BEFORE UPDATE OR DELETE ON public.after_trip_charge_settlements FOR EACH ROW EXECUTE FUNCTION public.prevent_after_trip_settlement_history_mutation();

CREATE OR REPLACE FUNCTION public.normalize_after_trip_reconciliation_charges(_charges jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE item jsonb; result jsonb='[]'::jsonb; category text; explanation text; amount bigint; ordinal integer=0;
BEGIN
  IF jsonb_typeof(_charges)<>'array' OR jsonb_array_length(_charges)=0 OR jsonb_array_length(_charges)>20 THEN RAISE EXCEPTION 'One to twenty charge lines are required.'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(_charges) LOOP
    ordinal:=ordinal+1; category:=item->>'category'; explanation:=btrim(COALESCE(item->>'explanation',''));
    BEGIN amount:=(item->>'amount_cents')::bigint; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Every charge amount must be integer cents.'; END;
    IF category NOT IN('tolls','excess_mileage','late_return','cleaning','damage','charging_energy','parking_tickets_violations','administrative_fee','other') THEN RAISE EXCEPTION 'Invalid after-trip category.'; END IF;
    IF amount<=0 THEN RAISE EXCEPTION 'Every charge amount must be greater than zero.'; END IF;
    IF length(explanation)<5 THEN RAISE EXCEPTION 'Every charge explanation is required.'; END IF;
    result:=result||jsonb_build_array(jsonb_build_object('ordinal',ordinal,'category',category,'amount_cents',amount,'explanation',explanation));
  END LOOP;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.normalize_after_trip_reconciliation_charges(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prepare_historical_after_trip_reconciliation(_booking_id uuid,_charges jsonb,_source_ledger_entry_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; source_entry public.booking_financial_ledger%ROWTYPE; normalized jsonb; total bigint; used bigint; refunded bigint; available bigint; source_kind text; fingerprint text;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF b.trip_status NOT IN('pending_inspection','completed') THEN RAISE EXCEPTION 'Historical after-trip reconciliation requires a returned or completed trip.'; END IF;
  SELECT * INTO source_entry FROM public.booking_financial_ledger WHERE id=_source_ledger_entry_id AND booking_id=b.id;
  IF NOT FOUND OR source_entry.status<>'succeeded' OR NOT(source_entry.effect='deposit_capture' OR (source_entry.effect='payment' AND source_entry.category='after_trip_payment')) THEN RAISE EXCEPTION 'A proven succeeded after-trip payment or deposit-capture ledger source is required.'; END IF;
  source_kind:=CASE WHEN source_entry.effect='deposit_capture' THEN 'security_deposit' ELSE 'separate_payment' END;
  normalized:=public.normalize_after_trip_reconciliation_charges(_charges);
  SELECT sum((value->>'amount_cents')::bigint) INTO total FROM jsonb_array_elements(normalized);
  SELECT COALESCE(sum(amount_cents),0) INTO used FROM public.after_trip_charge_settlements WHERE source_ledger_entry_id=source_entry.id AND status='proven';
  SELECT COALESCE(sum(amount_cents),0) INTO refunded FROM public.booking_financial_ledger WHERE booking_id=b.id AND effect IN('refund','deposit_refund') AND status='succeeded' AND external_reference IS NOT DISTINCT FROM source_entry.external_reference;
  available:=GREATEST(0,source_entry.amount_cents-refunded-used);
  IF available<=0 THEN RAISE EXCEPTION 'No unallocated proven source funds remain.'; END IF;
  fingerprint:=md5(jsonb_build_object('booking_id',b.id,'source_ledger_entry_id',source_entry.id,'source_amount_cents',source_entry.amount_cents,'source_refunded_cents',refunded,'source_already_allocated_cents',used,'source_available_cents',available,'source_external_reference',source_entry.external_reference,'charges',normalized)::text);
  RETURN jsonb_build_object('booking_id',b.id,'reservation_number',b.reservation_number,'charges',normalized,'total_charge_cents',total,'settlement_source',source_kind,'source_ledger_entry_id',source_entry.id,'source_external_reference',source_entry.external_reference,'source_amount_cents',source_entry.amount_cents,'source_refunded_cents',refunded,'source_already_allocated_cents',used,'source_available_cents',available,'proposed_settlement_cents',LEAST(total,available),'additional_balance_due_cents',GREATEST(0,total-available),'proposal_fingerprint',fingerprint,'writes_performed',false);
END; $$;
REVOKE ALL ON FUNCTION public.prepare_historical_after_trip_reconciliation(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_historical_after_trip_reconciliation(uuid,jsonb,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_historical_after_trip_reconciliation(
  _booking_id uuid,_charges jsonb,_source_ledger_entry_id uuid,_reason text,_idempotency_key text,_proposal_fingerprint text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE preview jsonb; existing uuid; reconciliation uuid; actor uuid; item jsonb; charge uuid; source_entry public.booking_financial_ledger%ROWTYPE; remaining_source bigint; allocation bigint;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
  IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Reconciliation reason is required.'; END IF;
  IF length(btrim(COALESCE(_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'Idempotency key is required.'; END IF;
  SELECT id INTO existing FROM public.after_trip_reconciliations WHERE booking_id=_booking_id AND idempotency_key=_idempotency_key;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  PERFORM 1 FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  preview:=public.prepare_historical_after_trip_reconciliation(_booking_id,_charges,_source_ledger_entry_id);
  IF preview->>'proposal_fingerprint'<>COALESCE(_proposal_fingerprint,'') THEN RAISE EXCEPTION 'Preview changed; prepare reconciliation again.'; END IF;
  SELECT * INTO source_entry FROM public.booking_financial_ledger WHERE id=_source_ledger_entry_id;
  actor:=public.current_profile_id();
  INSERT INTO public.after_trip_reconciliations(booking_id,source_ledger_entry_id,idempotency_key,proposal_fingerprint,reason,proposed_charges,total_charge_cents,settlement_source,created_by_profile_id)
  VALUES(_booking_id,_source_ledger_entry_id,btrim(_idempotency_key),preview->>'proposal_fingerprint',btrim(_reason),preview->'charges',(preview->>'total_charge_cents')::bigint,preview->>'settlement_source',actor) RETURNING id INTO reconciliation;
  remaining_source:=(preview->>'proposed_settlement_cents')::bigint;
  FOR item IN SELECT value FROM jsonb_array_elements(preview->'charges') LOOP
    allocation:=LEAST((item->>'amount_cents')::bigint,remaining_source);
    INSERT INTO public.after_trip_charges(booking_id,host_profile_id,renter_profile_id,category,amount_cents,currency,explanation,status,payment_status,idempotency_key,created_by_profile_id)
    SELECT b.id,b.host_profile_id,b.renter_profile_id,item->>'category',(item->>'amount_cents')::integer,b.currency,item->>'explanation',CASE WHEN allocation=(item->>'amount_cents')::bigint THEN 'paid' ELSE 'submitted' END,CASE WHEN allocation=(item->>'amount_cents')::bigint THEN 'paid' WHEN allocation>0 THEN 'pending' ELSE 'unpaid' END,'historical:'||reconciliation||':'||(item->>'ordinal'),actor FROM public.bookings b WHERE b.id=_booking_id RETURNING id INTO charge;
    INSERT INTO public.booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
    VALUES(_booking_id,NULL,'after-trip-charge:'||charge,'after_trip_charge',item->>'category',(item->>'amount_cents')::bigint,source_entry.currency,'trip_debit','paid','historical_after_trip_reconciliation',charge::text,item->>'explanation',now(),actor,jsonb_build_object('after_trip_reconciliation_id',reconciliation,'settlement_source',preview->>'settlement_source'));
    IF allocation>0 THEN
      INSERT INTO public.after_trip_charge_settlements(booking_id,charge_id,source_ledger_entry_id,reconciliation_id,amount_cents,currency,settlement_source,idempotency_key,created_by_profile_id)
      VALUES(_booking_id,charge,source_entry.id,reconciliation,allocation,source_entry.currency,preview->>'settlement_source','historical:'||reconciliation||':'||(item->>'ordinal'),actor);
      remaining_source:=remaining_source-allocation;
    END IF;
    INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,amount_cents,external_reference,actor_profile_id,actor_role)
    VALUES(_booking_id,'historical_after_trip_charge_reconciled',btrim(_reason),'{}',jsonb_build_object('charge_id',charge,'category',item->>'category','amount_cents',(item->>'amount_cents')::bigint,'settled_amount_cents',allocation,'settlement_source',preview->>'settlement_source','source_ledger_entry_id',source_entry.id,'source_external_reference',source_entry.external_reference), (item->>'amount_cents')::bigint,charge::text,actor,'admin');
  END LOOP;
  INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,amount_cents,external_reference,actor_profile_id,actor_role)
  VALUES(_booking_id,'historical_after_trip_reconciliation_confirmed',btrim(_reason),'{}',jsonb_build_object('reconciliation_id',reconciliation,'charge_count',jsonb_array_length(preview->'charges'),'settlement_source',preview->>'settlement_source','source_ledger_entry_id',source_entry.id,'source_external_reference',source_entry.external_reference,'proposal_fingerprint',preview->>'proposal_fingerprint'),(preview->>'total_charge_cents')::bigint,reconciliation::text,actor,'admin');
  RETURN reconciliation;
END; $$;
REVOKE ALL ON FUNCTION public.confirm_historical_after_trip_reconciliation(uuid,jsonb,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_historical_after_trip_reconciliation(uuid,jsonb,uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_allocate_after_trip_settlement(
  _charge_id uuid,_source_ledger_entry_id uuid,_amount_cents bigint,_reason text,_idempotency_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.after_trip_charges%ROWTYPE; source_entry public.booking_financial_ledger%ROWTYPE; actor uuid; allocated_to_charge bigint; allocated_from_source bigint; refunded bigint; available bigint; settlement uuid; source_kind text;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
  IF COALESCE(_amount_cents,0)<=0 THEN RAISE EXCEPTION 'Settlement amount must be greater than zero.'; END IF;
  IF length(btrim(COALESCE(_reason,'')))<5 OR length(btrim(COALESCE(_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'Reason and idempotency key are required.'; END IF;
  SELECT id INTO settlement FROM public.after_trip_charge_settlements WHERE booking_id=(SELECT booking_id FROM public.after_trip_charges WHERE id=_charge_id) AND idempotency_key=_idempotency_key;
  IF settlement IS NOT NULL THEN RETURN settlement; END IF;
  SELECT * INTO c FROM public.after_trip_charges WHERE id=_charge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'After-trip charge not found.'; END IF;
  IF c.status IN('waived','voided') THEN RAISE EXCEPTION 'Waived or voided charges cannot be settled.'; END IF;
  SELECT * INTO source_entry FROM public.booking_financial_ledger WHERE id=_source_ledger_entry_id AND booking_id=c.booking_id FOR UPDATE;
  IF NOT FOUND OR source_entry.status<>'succeeded' OR NOT(source_entry.effect='deposit_capture' OR(source_entry.effect='payment' AND source_entry.category='after_trip_payment')) THEN RAISE EXCEPTION 'A proven succeeded after-trip payment or deposit-capture ledger source is required.'; END IF;
  SELECT COALESCE(sum(amount_cents),0) INTO allocated_to_charge FROM public.after_trip_charge_settlements WHERE charge_id=c.id AND status='proven';
  SELECT COALESCE(sum(amount_cents),0) INTO allocated_from_source FROM public.after_trip_charge_settlements WHERE source_ledger_entry_id=source_entry.id AND status='proven';
  SELECT COALESCE(sum(amount_cents),0) INTO refunded FROM public.booking_financial_ledger WHERE booking_id=c.booking_id AND effect IN('refund','deposit_refund') AND status='succeeded' AND external_reference IS NOT DISTINCT FROM source_entry.external_reference;
  available:=GREATEST(0,source_entry.amount_cents-refunded-allocated_from_source);
  IF _amount_cents>c.amount_cents-allocated_to_charge THEN RAISE EXCEPTION 'Settlement exceeds the charge balance.'; END IF;
  IF _amount_cents>available THEN RAISE EXCEPTION 'Settlement exceeds unallocated proven source funds.'; END IF;
  source_kind:=CASE WHEN source_entry.effect='deposit_capture' THEN 'security_deposit' ELSE 'separate_payment' END; actor:=public.current_profile_id();
  INSERT INTO public.after_trip_charge_settlements(booking_id,charge_id,source_ledger_entry_id,amount_cents,currency,settlement_source,idempotency_key,created_by_profile_id)
  VALUES(c.booking_id,c.id,source_entry.id,_amount_cents,source_entry.currency,source_kind,btrim(_idempotency_key),actor) RETURNING id INTO settlement;
  INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,amount_cents,external_reference,actor_profile_id,actor_role)
  VALUES(c.booking_id,'after_trip_settlement_recorded',btrim(_reason),jsonb_build_object('charge_settled_cents',allocated_to_charge),jsonb_build_object('charge_settled_cents',allocated_to_charge+_amount_cents,'settlement_source',source_kind,'source_ledger_entry_id',source_entry.id,'source_external_reference',source_entry.external_reference),_amount_cents,settlement::text,actor,'admin');
  RETURN settlement;
END; $$;
REVOKE ALL ON FUNCTION public.admin_allocate_after_trip_settlement(uuid,uuid,bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_allocate_after_trip_settlement(uuid,uuid,bigint,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_booking_financial_summary(_booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; result jsonb; has_reconciliation boolean;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF NOT(public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.booking_financial_reconciliations r WHERE r.booking_id=b.id) INTO has_reconciliation;
  SELECT jsonb_build_object(
    'reconciled',has_reconciliation,
    'original_trip_amount_cents',CASE WHEN has_reconciliation THEN COALESCE(sum(amount_cents) FILTER(WHERE entry_type='booking_component' AND effect='trip_debit'),0) ELSE b.grand_total_cents END,
    'adjustments_cents',CASE WHEN has_reconciliation THEN COALESCE(sum(CASE WHEN entry_type<>'booking_component' AND entry_type<>'after_trip_charge' AND effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' AND category NOT LIKE 'after_trip_%' THEN -amount_cents ELSE 0 END),0) ELSE 0 END,
    'base_trip_total_cents',CASE WHEN has_reconciliation THEN COALESCE(sum(CASE WHEN entry_type<>'after_trip_charge' AND effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' AND category NOT LIKE 'after_trip_%' THEN -amount_cents ELSE 0 END),0) ELSE b.grand_total_cents END,
    'after_trip_charges_cents',COALESCE(sum(amount_cents) FILTER(WHERE entry_type='after_trip_charge' AND effect='trip_debit'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='trip_credit' AND category LIKE 'after_trip_%'),0),
    'final_trip_total_cents',(CASE WHEN has_reconciliation THEN COALESCE(sum(CASE WHEN effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' THEN -amount_cents ELSE 0 END),0) ELSE b.grand_total_cents+COALESCE(sum(amount_cents) FILTER(WHERE entry_type='after_trip_charge' AND effect='trip_debit'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='trip_credit' AND category LIKE 'after_trip_%'),0) END),
    'amount_paid_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='payment' AND status='succeeded'),0),
    'refunds_credits_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect IN('refund','trip_credit') AND status IN('succeeded','posted')),0),
    'net_trip_payments_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='payment' AND status='succeeded'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='refund' AND status='succeeded'),0),
    'after_trip_settled_from_deposit_cents',COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s WHERE s.booking_id=b.id AND s.status='proven' AND s.settlement_source='security_deposit'),0),
    'after_trip_settled_by_payment_cents',COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s WHERE s.booking_id=b.id AND s.status='proven' AND s.settlement_source='separate_payment'),0),
    'after_trip_outstanding_cents',GREATEST(0,COALESCE(sum(amount_cents) FILTER(WHERE entry_type='after_trip_charge' AND effect='trip_debit'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='trip_credit' AND category LIKE 'after_trip_%'),0)-COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s WHERE s.booking_id=b.id AND s.status='proven'),0)),
    'deposit_authorized_cents',COALESCE(max(amount_cents) FILTER(WHERE effect='authorization'),0),
    'deposit_captured_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_capture'),0),
    'deposit_released_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_release'),0),
    'deposit_refunded_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_refund' AND status='succeeded'),0),
    'net_deposit_retained_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_capture'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_refund' AND status='succeeded'),0),
    'balance_cents',GREATEST(0,(CASE WHEN has_reconciliation THEN COALESCE(sum(CASE WHEN effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' THEN -amount_cents ELSE 0 END),0) ELSE b.grand_total_cents+COALESCE(sum(amount_cents) FILTER(WHERE entry_type='after_trip_charge' AND effect='trip_debit'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='trip_credit' AND category LIKE 'after_trip_%'),0) END)-COALESCE(sum(amount_cents) FILTER(WHERE effect='payment' AND status='succeeded'),0)+COALESCE(sum(amount_cents) FILTER(WHERE effect='refund' AND status='succeeded'),0)-COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s JOIN public.booking_financial_ledger p ON p.id=s.source_ledger_entry_id WHERE s.booking_id=b.id AND s.status='proven' AND p.effect='deposit_capture'),0)),
    'deposit_settled',NOT EXISTS(SELECT 1 FROM public.booking_financial_ledger a WHERE a.booking_id=b.id AND a.effect='authorization' AND a.status NOT IN('canceled','succeeded')),
    'entries',COALESCE(jsonb_agg(jsonb_build_object('entry_type',l.entry_type,'category',l.category,'amount_cents',l.amount_cents,'currency',l.currency,'effect',l.effect,'status',l.status,'description',l.description,'occurred_at',l.occurred_at) ORDER BY occurred_at,created_at) FILTER(WHERE l.id IS NOT NULL),'[]'::jsonb)
  ) INTO result FROM public.booking_financial_ledger l WHERE l.booking_id=b.id;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_booking_financial_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_booking_financial_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_final_trip_receipt(_booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; operational jsonb; financial jsonb; charges jsonb;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF NOT(public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.booking_financial_reconciliations r WHERE r.booking_id=b.id) THEN RAISE EXCEPTION 'Financial reconciliation is required before a final receipt is available.'; END IF;
  SELECT to_jsonb(x) INTO operational FROM public.get_booking_operational_read_model() x WHERE x.id=b.id;
  financial:=public.get_booking_financial_summary(b.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'category',c.category,'amount_cents',c.amount_cents,'currency',c.currency,'explanation',c.explanation,'status',c.status,'submitted_at',c.submitted_at,
    'settled_amount_cents',COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s WHERE s.charge_id=c.id AND s.status='proven'),0),
    'remaining_amount_cents',GREATEST(0,c.amount_cents-COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s WHERE s.charge_id=c.id AND s.status='proven'),0)),
    'settlement_status',CASE WHEN c.status IN('waived','voided') THEN c.status WHEN COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s WHERE s.charge_id=c.id AND s.status='proven'),0)=0 THEN 'unpaid' WHEN COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s WHERE s.charge_id=c.id AND s.status='proven'),0)<c.amount_cents THEN 'partially_paid' ELSE 'paid' END,
    'settlements',COALESCE((SELECT jsonb_agg(jsonb_build_object('amount_cents',s.amount_cents,'currency',s.currency,'settlement_source',s.settlement_source,'status',s.status,'created_at',s.created_at)) FROM public.after_trip_charge_settlements s WHERE s.charge_id=c.id),'[]'::jsonb),
    'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'image_type',r.image_type,'notes',r.notes,'created_at',r.created_at)) FROM public.after_trip_charge_evidence e JOIN public.rental_images r ON r.id=e.rental_image_id WHERE e.charge_id=c.id),'[]'::jsonb)
  ) ORDER BY c.submitted_at),'[]'::jsonb) INTO charges FROM public.after_trip_charges c WHERE c.booking_id=b.id;
  RETURN jsonb_build_object('booking',operational,'financial',financial,'after_trip_charges',charges,'generated_at',now());
END; $$;
REVOKE ALL ON FUNCTION public.get_final_trip_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_final_trip_receipt(uuid) TO authenticated;