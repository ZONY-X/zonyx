-- Module 4B: immutable booking financial ledger and audited Admin reconciliation.
-- This migration does not call Stripe and does not alter existing booking totals.

CREATE TABLE public.booking_financial_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  source_observed_at timestamptz NOT NULL,
  source_snapshot jsonb NOT NULL,
  before_state jsonb NOT NULL,
  approved_ambiguous_payment_intent_ids text[] NOT NULL DEFAULT '{}',
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, idempotency_key)
);

CREATE TABLE public.booking_financial_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  reconciliation_id uuid NOT NULL REFERENCES public.booking_financial_reconciliations(id) ON DELETE RESTRICT,
  stable_key text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('booking_component','adjustment','payment','refund','credit','deposit_authorization','deposit_capture','deposit_release','deposit_refund','after_trip_charge')),
  category text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  effect text NOT NULL CHECK (effect IN ('trip_debit','trip_credit','payment','refund','authorization','deposit_capture','deposit_release','deposit_refund','informational')),
  status text NOT NULL,
  source text NOT NULL,
  external_reference text,
  description text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, stable_key)
);

CREATE TABLE public.booking_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  action_type text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  before_state jsonb NOT NULL DEFAULT '{}',
  after_state jsonb NOT NULL DEFAULT '{}',
  amount_cents bigint,
  external_reference text,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_role text NOT NULL DEFAULT 'admin',
  reconciliation_id uuid REFERENCES public.booking_financial_reconciliations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booking_financial_ledger_booking_idx ON public.booking_financial_ledger(booking_id, occurred_at, created_at);
CREATE INDEX booking_financial_reconciliations_booking_idx ON public.booking_financial_reconciliations(booking_id, created_at);
CREATE INDEX booking_audit_events_booking_idx ON public.booking_audit_events(booking_id, created_at);

ALTER TABLE public.booking_financial_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Financial reconciliations read admin" ON public.booking_financial_reconciliations FOR SELECT
USING (public.current_profile_is_admin());
CREATE POLICY "Financial ledger read admin" ON public.booking_financial_ledger FOR SELECT USING (public.current_profile_is_admin());
CREATE POLICY "Booking audits read admin" ON public.booking_audit_events FOR SELECT USING (public.current_profile_is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.booking_financial_reconciliations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.booking_financial_ledger FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.booking_audit_events FROM anon, authenticated;
GRANT SELECT ON public.booking_financial_reconciliations, public.booking_financial_ledger TO authenticated;
GRANT SELECT ON public.booking_audit_events TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_financial_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$ BEGIN RAISE EXCEPTION 'Financial history is immutable.'; END; $$;
CREATE TRIGGER prevent_reconciliation_mutation BEFORE UPDATE OR DELETE ON public.booking_financial_reconciliations FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_mutation();
CREATE TRIGGER prevent_ledger_mutation BEFORE UPDATE OR DELETE ON public.booking_financial_ledger FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_mutation();
CREATE TRIGGER prevent_booking_audit_mutation BEFORE UPDATE OR DELETE ON public.booking_audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_mutation();

CREATE OR REPLACE FUNCTION public.persist_booking_financial_reconciliation(
  _booking_id uuid, _idempotency_key text, _reason text, _source_observed_at timestamptz,
  _source_snapshot jsonb, _before_state jsonb, _approved_ambiguous_ids text[],
  _actor_profile_id uuid, _entries jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reconciliation_id uuid; item jsonb;
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
  IF length(btrim(COALESCE(_reason,''))) < 5 THEN RAISE EXCEPTION 'Reconciliation reason is required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id) THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.user_id WHERE p.id=_actor_profile_id AND p.is_admin AND lower(p.email)='zoeysnp@gmail.com' AND lower(u.email)='zoeysnp@gmail.com') THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
  SELECT id INTO reconciliation_id FROM public.booking_financial_reconciliations WHERE booking_id=_booking_id AND idempotency_key = _idempotency_key;
  IF reconciliation_id IS NOT NULL THEN RETURN reconciliation_id; END IF;
  INSERT INTO public.booking_financial_reconciliations(booking_id,idempotency_key,reason,source_observed_at,source_snapshot,before_state,approved_ambiguous_payment_intent_ids,created_by_profile_id)
  VALUES(_booking_id,_idempotency_key,btrim(_reason),_source_observed_at,_source_snapshot,_before_state,COALESCE(_approved_ambiguous_ids,'{}'),_actor_profile_id)
  ON CONFLICT (booking_id, idempotency_key) DO NOTHING RETURNING id INTO reconciliation_id;
  IF reconciliation_id IS NULL THEN SELECT id INTO reconciliation_id FROM public.booking_financial_reconciliations WHERE booking_id=_booking_id AND idempotency_key=_idempotency_key; RETURN reconciliation_id; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(_entries) LOOP
    INSERT INTO public.booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
    VALUES(_booking_id,reconciliation_id,item->>'stable_key',item->>'entry_type',item->>'category',(item->>'amount_cents')::bigint,COALESCE(item->>'currency','usd'),item->>'effect',item->>'status',item->>'source',item->>'external_reference',item->>'description',(item->>'occurred_at')::timestamptz,_actor_profile_id,COALESCE(item->'metadata','{}'::jsonb))
    ON CONFLICT (booking_id,stable_key) DO NOTHING;
  END LOOP;
  INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,actor_profile_id,reconciliation_id)
  VALUES(_booking_id,'financial_reconciliation',btrim(_reason),_before_state,jsonb_build_object('ledger_entries',jsonb_array_length(_entries),'approved_ambiguous_ids',COALESCE(_approved_ambiguous_ids,'{}')),_actor_profile_id,reconciliation_id);
  RETURN reconciliation_id;
END; $$;
REVOKE ALL ON FUNCTION public.persist_booking_financial_reconciliation(uuid,text,text,timestamptz,jsonb,jsonb,text[],uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_booking_financial_reconciliation(uuid,text,text,timestamptz,jsonb,jsonb,text[],uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_booking_financial_summary(_booking_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.bookings%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF NOT (public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
  SELECT jsonb_build_object(
    'reconciled', EXISTS(SELECT 1 FROM public.booking_financial_reconciliations r WHERE r.booking_id=b.id),
    'original_trip_amount_cents', COALESCE(sum(amount_cents) FILTER(WHERE entry_type='booking_component' AND effect='trip_debit'),0),
    'adjustments_cents', COALESCE(sum(CASE WHEN entry_type<>'booking_component' AND effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' THEN -amount_cents ELSE 0 END),0),
    'final_trip_total_cents', COALESCE(sum(CASE WHEN effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' THEN -amount_cents ELSE 0 END),0),
    'amount_paid_cents', COALESCE(sum(amount_cents) FILTER(WHERE effect='payment' AND status='succeeded'),0),
    'refunds_credits_cents', COALESCE(sum(amount_cents) FILTER(WHERE effect IN ('refund','trip_credit') AND status IN ('succeeded','posted')),0),
    'deposit_authorized_cents', COALESCE(max(amount_cents) FILTER(WHERE effect='authorization'),0),
    'deposit_captured_cents', COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_capture'),0),
    'deposit_released_cents', COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_release'),0),
    'deposit_refunded_cents', COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_refund' AND status='succeeded'),0),
    'net_deposit_retained_cents', COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_capture'),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='deposit_refund' AND status='succeeded'),0),
    'balance_cents', COALESCE(sum(CASE WHEN effect='trip_debit' THEN amount_cents WHEN effect='trip_credit' THEN -amount_cents ELSE 0 END),0)-COALESCE(sum(amount_cents) FILTER(WHERE effect='payment' AND status='succeeded'),0)+COALESCE(sum(amount_cents) FILTER(WHERE effect='refund' AND status='succeeded'),0),
    'deposit_settled', NOT EXISTS(SELECT 1 FROM public.booking_financial_ledger a WHERE a.booking_id=b.id AND a.effect='authorization' AND a.status NOT IN ('canceled','succeeded')),
    'entries', COALESCE(jsonb_agg(jsonb_build_object('entry_type',l.entry_type,'category',l.category,'amount_cents',l.amount_cents,'currency',l.currency,'effect',l.effect,'status',l.status,'description',l.description,'occurred_at',l.occurred_at) ORDER BY occurred_at,created_at) FILTER(WHERE l.id IS NOT NULL),'[]'::jsonb)
  ) INTO result FROM public.booking_financial_ledger l WHERE l.booking_id=b.id;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_booking_financial_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_financial_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_correct_historical_booking_schedule(
  _booking_id uuid, _start_date date, _pickup_time time, _end_date date, _dropoff_time time, _reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; actor uuid; old_state jsonb; new_state jsonb; start_ts timestamp; end_ts timestamp;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
  IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Correction reason is required.'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  start_ts := _start_date::timestamp + COALESCE(_pickup_time,time '00:00'); end_ts := _end_date::timestamp + COALESCE(_dropoff_time,time '00:00');
  IF end_ts<=start_ts THEN RAISE EXCEPTION 'Drop-off must be after pickup.'; END IF;
  IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id AND x.trip_status IN('confirmed','active','pending_inspection','completed') AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)') && tsrange(start_ts,end_ts,'[)')) THEN RAISE EXCEPTION 'Corrected schedule conflicts with another booking.'; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && tsrange(start_ts,end_ts,'[)')) THEN RAISE EXCEPTION 'Corrected schedule conflicts with a blocked period.'; END IF;
  old_state:=jsonb_build_object('start_date',b.start_date,'pickup_time',b.pickup_time,'end_date',b.end_date,'dropoff_time',b.dropoff_time,'grand_total_cents',b.grand_total_cents);
  new_state:=jsonb_build_object('start_date',_start_date,'pickup_time',_pickup_time,'end_date',_end_date,'dropoff_time',_dropoff_time,'grand_total_cents',b.grand_total_cents);
  actor:=public.current_profile_id();
  UPDATE public.bookings SET start_date=_start_date,pickup_time=_pickup_time,end_date=_end_date,dropoff_time=_dropoff_time,updated_at=now() WHERE id=b.id;
  INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,actor_profile_id) VALUES(b.id,'historical_schedule_correction',btrim(_reason),old_state,new_state,actor);
END; $$;
REVOKE ALL ON FUNCTION public.admin_correct_historical_booking_schedule(uuid,date,time,date,time,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_historical_booking_schedule(uuid,date,time,date,time,text) TO authenticated;