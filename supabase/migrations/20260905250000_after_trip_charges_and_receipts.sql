-- Module 4C: after-trip charge requests and canonical live trip receipts.
-- Submitted requests never move money and are never marked paid without separate
-- proven payment ledger evidence.

ALTER TABLE public.booking_financial_ledger ALTER COLUMN reconciliation_id DROP NOT NULL;

CREATE TABLE public.after_trip_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  host_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  renter_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('tolls','excess_mileage','late_return','cleaning','damage','charging_energy','parking_tickets_violations','other')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  explanation text NOT NULL CHECK (length(btrim(explanation)) >= 5),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','disputed','waived','voided','pending_payment','paid')),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid')),
  idempotency_key text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, idempotency_key)
);

CREATE TABLE public.after_trip_charge_evidence (
  charge_id uuid NOT NULL REFERENCES public.after_trip_charges(id) ON DELETE RESTRICT,
  rental_image_id uuid NOT NULL REFERENCES public.rental_images(id) ON DELETE RESTRICT,
  attached_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (charge_id, rental_image_id)
);

CREATE INDEX after_trip_charges_booking_idx ON public.after_trip_charges(booking_id, submitted_at);
CREATE INDEX after_trip_charges_host_idx ON public.after_trip_charges(host_profile_id, submitted_at);

ALTER TABLE public.after_trip_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.after_trip_charge_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "After trip charges read participants" ON public.after_trip_charges FOR SELECT USING (
  public.current_profile_is_admin() OR renter_profile_id=public.current_profile_id() OR host_profile_id=public.current_profile_id()
);
CREATE POLICY "After trip evidence read participants" ON public.after_trip_charge_evidence FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.after_trip_charges c WHERE c.id=charge_id AND (public.current_profile_is_admin() OR c.renter_profile_id=public.current_profile_id() OR c.host_profile_id=public.current_profile_id()))
);
REVOKE INSERT,UPDATE,DELETE ON public.after_trip_charges,public.after_trip_charge_evidence FROM anon,authenticated;
GRANT SELECT ON public.after_trip_charges,public.after_trip_charge_evidence TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_after_trip_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND current_setting('app.after_trip_admin_transition',true)='allowed' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'After-trip history is immutable through direct writes.';
END; $$;
CREATE TRIGGER prevent_after_trip_charge_direct_mutation BEFORE UPDATE OR DELETE ON public.after_trip_charges FOR EACH ROW EXECUTE FUNCTION public.prevent_after_trip_history_mutation();
CREATE TRIGGER prevent_after_trip_evidence_direct_mutation BEFORE UPDATE OR DELETE ON public.after_trip_charge_evidence FOR EACH ROW EXECUTE FUNCTION public.prevent_after_trip_history_mutation();

CREATE OR REPLACE FUNCTION public.submit_after_trip_charge(
  _booking_id uuid, _category text, _amount_cents integer, _explanation text,
  _evidence_ids uuid[] DEFAULT '{}', _idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; actor uuid; charge_id uuid; evidence_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  actor:=public.current_profile_id();
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF b.host_profile_id<>actor THEN RAISE EXCEPTION 'Only the booking provider may submit an after-trip charge.'; END IF;
  IF b.trip_status NOT IN ('pending_inspection','completed') THEN RAISE EXCEPTION 'After-trip charges require a returned or completed trip.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.booking_financial_reconciliations r WHERE r.booking_id=b.id) THEN RAISE EXCEPTION 'Financial reconciliation is required before submitting after-trip charges.'; END IF;
  IF _category NOT IN ('tolls','excess_mileage','late_return','cleaning','damage','charging_energy','parking_tickets_violations','other') THEN RAISE EXCEPTION 'Invalid charge category.'; END IF;
  IF COALESCE(_amount_cents,0)<=0 THEN RAISE EXCEPTION 'Charge amount must be greater than zero.'; END IF;
  IF length(btrim(COALESCE(_explanation,'')))<5 THEN RAISE EXCEPTION 'Charge explanation is required.'; END IF;
  IF length(btrim(COALESCE(_idempotency_key,'')))<8 THEN RAISE EXCEPTION 'Idempotency key is required.'; END IF;
  SELECT id INTO charge_id FROM public.after_trip_charges WHERE booking_id=b.id AND idempotency_key=_idempotency_key;
  IF charge_id IS NOT NULL THEN RETURN charge_id; END IF;
  IF EXISTS(SELECT 1 FROM unnest(COALESCE(_evidence_ids,'{}')) e WHERE NOT EXISTS(SELECT 1 FROM public.rental_images r WHERE r.id=e AND r.booking_id=b.id)) THEN RAISE EXCEPTION 'Evidence must belong to this booking.'; END IF;
  INSERT INTO public.after_trip_charges(booking_id,host_profile_id,renter_profile_id,category,amount_cents,explanation,idempotency_key,created_by_profile_id)
  VALUES(b.id,b.host_profile_id,b.renter_profile_id,_category,_amount_cents,btrim(_explanation),btrim(_idempotency_key),actor) RETURNING id INTO charge_id;
  FOR evidence_id IN SELECT DISTINCT unnest(COALESCE(_evidence_ids,'{}')) LOOP
    INSERT INTO public.after_trip_charge_evidence(charge_id,rental_image_id,attached_by_profile_id) VALUES(charge_id,evidence_id,actor);
  END LOOP;
  INSERT INTO public.booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
  VALUES(b.id,NULL,'after-trip-charge:'||charge_id,'after_trip_charge',_category,_amount_cents,b.currency,'trip_debit','submitted','after_trip_charge_request',charge_id::text,btrim(_explanation),now(),actor,jsonb_build_object('payment_status','unpaid'));
  INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,amount_cents,external_reference,actor_profile_id,actor_role)
  VALUES(b.id,'after_trip_charge_submitted',btrim(_explanation),'{}',jsonb_build_object('charge_id',charge_id,'category',_category,'status','submitted','payment_status','unpaid','evidence_ids',COALESCE(_evidence_ids,'{}')),_amount_cents,charge_id::text,actor,'host');
  RETURN charge_id;
END; $$;
REVOKE ALL ON FUNCTION public.submit_after_trip_charge(uuid,text,integer,text,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_after_trip_charge(uuid,text,integer,text,uuid[],text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_after_trip_charge_status(_charge_id uuid,_new_status text,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.after_trip_charges%ROWTYPE; actor uuid;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
  IF _new_status NOT IN ('disputed','waived','voided') THEN RAISE EXCEPTION 'Unsupported administrative status.'; END IF;
  IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Administrative reason is required.'; END IF;
  SELECT * INTO c FROM public.after_trip_charges WHERE id=_charge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'After-trip charge not found.'; END IF;
  IF c.status=_new_status THEN RETURN; END IF;
  IF c.status IN ('paid','waived','voided') THEN RAISE EXCEPTION 'After-trip charge is already final.'; END IF;
  actor:=public.current_profile_id();
  PERFORM set_config('app.after_trip_admin_transition','allowed',true);
  UPDATE public.after_trip_charges SET status=_new_status,status_changed_at=now() WHERE id=c.id;
  IF _new_status IN ('waived','voided') THEN
    INSERT INTO public.booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
    VALUES(c.booking_id,NULL,'after-trip-credit:'||c.id,'credit','after_trip_'||_new_status,c.amount_cents,c.currency,'trip_credit','posted','after_trip_admin_resolution',c.id::text,'After-trip charge '||_new_status,now(),actor,jsonb_build_object('reason',btrim(_reason))) ON CONFLICT(booking_id,stable_key) DO NOTHING;
  END IF;
  INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,amount_cents,external_reference,actor_profile_id,actor_role)
  VALUES(c.booking_id,'after_trip_charge_status_changed',btrim(_reason),jsonb_build_object('status',c.status,'payment_status',c.payment_status),jsonb_build_object('status',_new_status,'payment_status',c.payment_status),c.amount_cents,c.id::text,actor,'admin');
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_after_trip_charge_status(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_after_trip_charge_status(uuid,text,text) TO authenticated;

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
    'after_trip_charges_cents',COALESCE(sum(amount_cents) FILTER(WHERE entry_type='after_trip_charge' AND effect='trip_debit'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='trip_credit' AND category LIKE 'after_trip_%'),0),
    'final_trip_total_cents',(CASE WHEN has_reconciliation THEN COALESCE(sum(CASE WHEN effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' THEN -amount_cents ELSE 0 END),0) ELSE b.grand_total_cents+COALESCE(sum(amount_cents) FILTER(WHERE entry_type='after_trip_charge' AND effect='trip_debit'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='trip_credit' AND category LIKE 'after_trip_%'),0) END),
    'amount_paid_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='payment' AND status='succeeded'),0),
    'refunds_credits_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect IN('refund','trip_credit') AND status IN('succeeded','posted')),0),
    'net_trip_payments_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='payment' AND status='succeeded'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='refund' AND status='succeeded'),0),
    'deposit_authorized_cents',COALESCE(max(amount_cents) FILTER(WHERE effect='authorization'),0),
    'deposit_captured_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_capture'),0),
    'deposit_released_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_release'),0),
    'deposit_refunded_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_refund' AND status='succeeded'),0),
    'net_deposit_retained_cents',COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_capture'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_refund' AND status='succeeded'),0),
    'balance_cents',(CASE WHEN has_reconciliation THEN COALESCE(sum(CASE WHEN effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' THEN -amount_cents ELSE 0 END),0) ELSE b.grand_total_cents+COALESCE(sum(amount_cents) FILTER(WHERE entry_type='after_trip_charge' AND effect='trip_debit'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='trip_credit' AND category LIKE 'after_trip_%'),0) END)-COALESCE(sum(amount_cents) FILTER(WHERE effect='payment' AND status='succeeded'),0)+COALESCE(sum(amount_cents) FILTER(WHERE effect='refund' AND status='succeeded'),0),
    'deposit_settled',NOT EXISTS(SELECT 1 FROM public.booking_financial_ledger a WHERE a.booking_id=b.id AND a.effect='authorization' AND a.status NOT IN('canceled','succeeded')),
    'entries',COALESCE(jsonb_agg(jsonb_build_object('entry_type',l.entry_type,'category',l.category,'amount_cents',l.amount_cents,'currency',l.currency,'effect',l.effect,'status',l.status,'description',l.description,'occurred_at',l.occurred_at) ORDER BY occurred_at,created_at) FILTER(WHERE l.id IS NOT NULL),'[]'::jsonb)
  ) INTO result FROM public.booking_financial_ledger l WHERE l.booking_id=b.id;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_booking_financial_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_booking_financial_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_booking_operational_read_model()
RETURNS TABLE(id uuid,reservation_number text,renter_profile_id uuid,host_profile_id uuid,vehicle_id uuid,start_date date,pickup_time time,end_date date,dropoff_time time,pickup_location text,dropoff_location text,fulfillment_method text,trip_status text,original_booking_total_cents integer,displayed_total_cents bigint,currency text,is_financially_reconciled boolean,deposit_authorized_cents bigint,deposit_captured_cents bigint,deposit_released_cents bigint,deposit_refunded_cents bigint,deposit_settled boolean,subtotal_cents integer,service_fee_cents integer,taxes_cents integer,stripe_checkout_session_id text,authorization_hold_payment_intent_id text,authorization_hold_amount_cents integer,authorization_hold_status text,vehicle_brand text,vehicle_model text,vehicle_image_url text,renter_name text,renter_email text,provider_name text,provider_email text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
SELECT b.id,b.reservation_number,b.renter_profile_id,b.host_profile_id,b.vehicle_id,b.start_date,b.pickup_time,b.end_date,b.dropoff_time,b.pickup_location,b.dropoff_location,b.fulfillment_method,b.trip_status,b.grand_total_cents,
  CASE WHEN fs.reconciled THEN fs.trip_total ELSE b.grand_total_cents::bigint+COALESCE(fs.after_trip_total,0) END,b.currency,COALESCE(fs.reconciled,false),COALESCE(fs.deposit_authorized,0),COALESCE(fs.deposit_captured,0),COALESCE(fs.deposit_released,0),COALESCE(fs.deposit_refunded,0),COALESCE(fs.deposit_settled,false),b.subtotal_cents,b.service_fee_cents,b.taxes_cents,b.stripe_checkout_session_id,b.authorization_hold_payment_intent_id,b.authorization_hold_amount_cents,b.authorization_hold_status,v.brand,v.model,v.image_url,r.full_name,r.email,p.full_name,p.email
FROM public.bookings b JOIN public.vehicles v ON v.id=b.vehicle_id JOIN public.profiles r ON r.id=b.renter_profile_id JOIN public.profiles p ON p.id=b.host_profile_id
LEFT JOIN LATERAL(SELECT EXISTS(SELECT 1 FROM public.booking_financial_reconciliations z WHERE z.booking_id=b.id) reconciled,COALESCE(sum(CASE WHEN l.effect='trip_debit' THEN l.amount_cents WHEN l.effect='trip_credit' THEN -l.amount_cents ELSE 0 END),0) trip_total,COALESCE(sum(l.amount_cents) FILTER(WHERE l.entry_type='after_trip_charge' AND l.effect='trip_debit'),0)-COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='trip_credit' AND l.category LIKE 'after_trip_%'),0) after_trip_total,COALESCE(max(l.amount_cents) FILTER(WHERE l.effect='authorization'),0) deposit_authorized,COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_capture'),0) deposit_captured,COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_release'),0) deposit_released,COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_refund' AND l.status='succeeded'),0) deposit_refunded,NOT EXISTS(SELECT 1 FROM public.booking_financial_ledger a WHERE a.booking_id=b.id AND a.effect='authorization' AND a.status NOT IN('canceled','succeeded')) deposit_settled FROM public.booking_financial_ledger l WHERE l.booking_id=b.id)fs ON true
WHERE auth.uid() IS NOT NULL AND(public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()); $$;
REVOKE ALL ON FUNCTION public.get_booking_operational_read_model() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_booking_operational_read_model() TO authenticated;

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
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'category',c.category,'amount_cents',c.amount_cents,'currency',c.currency,'explanation',c.explanation,'status',c.status,'payment_status',CASE WHEN EXISTS(SELECT 1 FROM public.booking_financial_ledger p WHERE p.booking_id=c.booking_id AND p.effect='payment' AND p.status='succeeded' AND p.metadata->>'after_trip_charge_id'=c.id::text) THEN 'paid' ELSE c.payment_status END,'submitted_at',c.submitted_at,'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'image_type',r.image_type,'notes',r.notes,'created_at',r.created_at)) FROM public.after_trip_charge_evidence e JOIN public.rental_images r ON r.id=e.rental_image_id WHERE e.charge_id=c.id),'[]'::jsonb)) ORDER BY c.submitted_at),'[]'::jsonb) INTO charges FROM public.after_trip_charges c WHERE c.booking_id=b.id;
  RETURN jsonb_build_object('booking',operational,'financial',financial,'after_trip_charges',charges,'generated_at',now());
END; $$;
REVOKE ALL ON FUNCTION public.get_final_trip_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_final_trip_receipt(uuid) TO authenticated;