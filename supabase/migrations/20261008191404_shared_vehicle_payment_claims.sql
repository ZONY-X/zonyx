-- Coordinated activation migration. Apply only in isolated sandbox for now.
-- Durable inventory claims never expire or release on cancellation/timeout/refund.
-- Provider outcome reconciliation is required before any future release design.
CREATE TABLE public.vehicle_payment_claims (
 payment_id uuid PRIMARY KEY REFERENCES public.booking_payments(id) ON DELETE RESTRICT,
 booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
 vehicle_id uuid NOT NULL,
 reserved_span tsrange NOT NULL CHECK (NOT isempty(reserved_span)),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_payment_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_payment_claims FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.vehicle_payment_claims TO service_role;
CREATE FUNCTION public.ensure_shared_vehicle_payment_claim(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE; b public.bookings%ROWTYPE; c public.vehicle_payment_claims%ROWTYPE; span tsrange;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id;
 SELECT * INTO b FROM public.bookings WHERE id=p.booking_id;
 IF p.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'Shared claim payment missing'; END IF;
 span:=tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)');
 IF isempty(span) OR lower_inf(span) OR upper_inf(span) THEN RAISE EXCEPTION 'Invalid shared reservation span'; END IF;
 -- Callers lock their booking/payment first; never lock a competing booking.
 -- Different bookings serialize on this vehicle, then inspect committed claims.
 PERFORM pg_advisory_xact_lock(hashtextextended(b.vehicle_id::text,0));
 SELECT * INTO c FROM public.vehicle_payment_claims WHERE payment_id=p.id;
 IF FOUND THEN
  IF c.booking_id<>b.id OR c.vehicle_id<>b.vehicle_id OR c.reserved_span<>span THEN RAISE EXCEPTION 'Shared reservation terms changed'; END IF;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_payment_claims x WHERE x.vehicle_id=b.vehicle_id AND x.booking_id<>b.id AND x.reserved_span && span) THEN RAISE EXCEPTION 'Shared vehicle payment reservation conflicts'; END IF;
 -- Fail closed for legacy/unknown earlier attempts, including unattached neutral
 -- payment reservations. Never import or relabel a production Stripe session.
 IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id
  AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)') && span
  AND (x.trip_status IN ('confirmed','active','pending_inspection','completed') OR x.stripe_checkout_session_id IS NOT NULL OR x.authorization_hold_payment_intent_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.booking_payments xp WHERE xp.booking_id=x.id))) THEN RAISE EXCEPTION 'Shared vehicle payment reservation conflicts'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && span) THEN RAISE EXCEPTION 'Vehicle blocked'; END IF;
 INSERT INTO public.vehicle_payment_claims(payment_id,booking_id,vehicle_id,reserved_span) VALUES(p.id,b.id,b.vehicle_id,span);
END; $$;
REVOKE ALL ON FUNCTION public.ensure_shared_vehicle_payment_claim(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_shared_vehicle_payment_claim(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.reserve_rental_payment_provider(_booking_id uuid,_agreement_id uuid,_provider text,_user_id uuid,_environment text)
RETURNS public.booking_payments LANGUAGE plpgsql SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; p public.booking_payments%ROWTYPE; s jsonb;
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF _provider NOT IN ('stripe','paypal') OR _environment NOT IN ('sandbox','live') THEN RAISE EXCEPTION 'Unsupported provider configuration'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  SELECT * INTO a FROM public.booking_rental_agreements WHERE id=_agreement_id AND booking_id=b.id;
  IF NOT FOUND OR a.accepted_at IS NULL OR a.guest_auth_user_id<>_user_id OR a.guest_profile_id<>b.renter_profile_id OR b.terms_accepted_at IS NULL OR b.rental_agreement_accepted_at IS NULL THEN RAISE EXCEPTION 'Accepted agreement required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=b.renter_profile_id AND user_id=_user_id) THEN RAISE EXCEPTION 'Booking owner required'; END IF;
  s:=a.trip_financial_summary;
  IF (s->>'currency') IS DISTINCT FROM 'usd' OR b.currency IS DISTINCT FROM 'usd' OR b.grand_total_cents<50
    OR (s->>'subtotal_cents')::bigint IS DISTINCT FROM b.subtotal_cents
    OR (s->>'service_fee_cents')::bigint IS DISTINCT FROM b.service_fee_cents
    OR (s->>'taxes_cents')::bigint IS DISTINCT FROM b.taxes_cents
    OR (s->>'final_total_cents')::bigint IS DISTINCT FROM b.grand_total_cents THEN RAISE EXCEPTION 'Agreement price mismatch'; END IF;
  IF (s->>'vehicle_id')::uuid IS DISTINCT FROM b.vehicle_id OR (s->>'start_date')::date IS DISTINCT FROM b.start_date OR (s->>'end_date')::date IS DISTINCT FROM b.end_date OR (s->>'pickup_time')::time IS DISTINCT FROM b.pickup_time OR (s->>'dropoff_time')::time IS DISTINCT FROM b.dropoff_time OR (s->>'pickup_location') IS DISTINCT FROM b.pickup_location OR (s->>'dropoff_location') IS DISTINCT FROM b.dropoff_location OR (s->>'fulfillment_method') IS DISTINCT FROM b.fulfillment_method THEN RAISE EXCEPTION 'Agreement reservation mismatch'; END IF;
  IF b.trip_status<>'pending_payment' THEN RAISE EXCEPTION 'Booking is not pending payment'; END IF;
  SELECT * INTO p FROM public.booking_payments WHERE booking_id=b.id;
  IF FOUND THEN
    IF p.provider<>_provider OR p.environment<>_environment OR p.agreement_id<>a.id OR p.amount_cents<>b.grand_total_cents THEN RAISE EXCEPTION 'Existing provider payment conflicts'; END IF;
    PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
    RETURN p;
  END IF;
  IF b.trip_status<>'pending_payment' THEN RAISE EXCEPTION 'Booking is not pending payment'; END IF;
  IF _provider='paypal' AND (b.stripe_checkout_session_id IS NOT NULL OR b.stripe_customer_id IS NOT NULL OR b.authorization_hold_payment_intent_id IS NOT NULL) THEN RAISE EXCEPTION 'Existing Stripe transaction cannot become PayPal'; END IF;
  INSERT INTO public.booking_payments(booking_id,agreement_id,provider,environment,amount_cents,currency,state)
    VALUES(b.id,a.id,_provider,_environment,b.grand_total_cents,b.currency,CASE WHEN _provider='paypal' THEN 'creating' ELSE 'awaiting_approval' END) RETURNING * INTO p;
  PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
    RETURN p;
END; $$;


-- Preserve accepted inventory/price/provider identity throughout uncertain or paid outcomes.
CREATE FUNCTION public.guard_shared_vehicle_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.vehicle_payment_claims WHERE booking_id=OLD.id) AND
  (NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.pickup_time IS DISTINCT FROM OLD.pickup_time OR NEW.dropoff_time IS DISTINCT FROM OLD.dropoff_time OR NEW.grand_total_cents IS DISTINCT FROM OLD.grand_total_cents OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.renter_profile_id IS DISTINCT FROM OLD.renter_profile_id) THEN RAISE EXCEPTION 'Shared payment reservation terms are locked'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_shared_vehicle_booking BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.guard_shared_vehicle_booking();
REVOKE ALL ON FUNCTION public.guard_shared_vehicle_booking() FROM PUBLIC,anon,authenticated;
-- Stripe uses one durable dispatch claim. Unknown creation outcomes never retry
-- a POST after Stripe's finite idempotency retention; recover an existing ID only.
ALTER TABLE public.booking_payments ADD COLUMN stripe_create_started_at timestamptz;
CREATE FUNCTION public.claim_sandbox_stripe_dispatch(_payment_id uuid) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
 IF p.provider<>'stripe' OR p.environment<>'sandbox' THEN RAISE EXCEPTION 'Sandbox Stripe payment required'; END IF;
 PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
 IF p.stripe_create_started_at IS NOT NULL OR p.order_id IS NOT NULL THEN RETURN false; END IF;
 UPDATE public.booking_payments SET stripe_create_started_at=now(),state='creating' WHERE id=p.id;
 RETURN true;
END; $$;
CREATE FUNCTION public.attach_sandbox_stripe_session(_payment_id uuid,_session_id text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
 IF p.provider<>'stripe' OR p.environment<>'sandbox' OR _session_id NOT LIKE 'cs_test_%' OR (p.order_id IS NOT NULL AND p.order_id<>_session_id) THEN RAISE EXCEPTION 'Sandbox Stripe session identity conflicts'; END IF;
 PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
 UPDATE public.booking_payments SET order_id=_session_id,state=CASE WHEN state='paid' THEN state ELSE 'awaiting_approval' END WHERE id=p.id;
 UPDATE public.bookings SET stripe_checkout_session_id=_session_id WHERE id=p.booking_id;
END; $$;
CREATE FUNCTION public.finalize_sandbox_stripe_payment(_payment_id uuid,_session_id text,_capture_id text,_amount_cents bigint,_currency text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
 IF p.provider<>'stripe' OR p.environment<>'sandbox' OR p.order_id IS DISTINCT FROM _session_id OR _session_id NOT LIKE 'cs_test_%' OR _capture_id IS NULL OR _capture_id NOT LIKE 'pi_%' OR p.amount_cents IS DISTINCT FROM _amount_cents OR p.currency IS DISTINCT FROM _currency OR (p.capture_id IS NOT NULL AND p.capture_id<>_capture_id) THEN RAISE EXCEPTION 'Sandbox Stripe settlement evidence conflicts'; END IF;
 PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
 UPDATE public.booking_payments SET state='paid',capture_id=_capture_id,paid_at=COALESCE(paid_at,now()) WHERE id=p.id;
 -- No trip confirmation, deposit authorization, refund or other provider call.
END; $$;
REVOKE ALL ON FUNCTION public.claim_sandbox_stripe_dispatch(uuid),public.attach_sandbox_stripe_session(uuid,text),public.finalize_sandbox_stripe_payment(uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sandbox_stripe_dispatch(uuid),public.attach_sandbox_stripe_session(uuid,text),public.finalize_sandbox_stripe_payment(uuid,text,text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_paypal_rental_payment(_payment_id uuid,_order_id text,_capture_id text,_amount_cents bigint,_currency text,_deposit_status text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; deposit_state text;
BEGIN
  PERFORM 1 FROM public.bookings b JOIN public.booking_payments x ON x.booking_id=b.id WHERE x.id=_payment_id FOR UPDATE OF b;
  SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id AND provider='paypal' FOR UPDATE;
  IF NOT FOUND OR p.order_id IS DISTINCT FROM _order_id OR p.amount_cents IS DISTINCT FROM _amount_cents OR p.currency IS DISTINCT FROM _currency OR NULLIF(_capture_id,'') IS NULL THEN RAISE EXCEPTION 'Capture integrity failure'; END IF;
  IF p.capture_id IS NOT NULL AND p.capture_id<>_capture_id THEN RAISE EXCEPTION 'Duplicate capture identity'; END IF;
  PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
  -- Paid receipt is permanent even if a later external refund needs review.
  IF p.paid_at IS NULL THEN
    UPDATE public.booking_payments SET capture_id=_capture_id,state=CASE WHEN state IN ('cancelled','failed','reconciliation_required') THEN 'reconciliation_required' ELSE 'paid' END,paid_at=now(),updated_at=now() WHERE id=p.id;
  END IF;
  SELECT * INTO a FROM public.booking_rental_agreements WHERE id=p.agreement_id;
  deposit_state:=CASE WHEN _deposit_status='capability_verification_required' THEN _deposit_status ELSE 'disabled' END;
  INSERT INTO public.booking_security_deposits(booking_id,rental_payment_id,provider,amount_cents,status)
    VALUES(p.booking_id,p.id,'paypal',(a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint,deposit_state)
    ON CONFLICT(booking_id,generation) DO NOTHING;
  -- Deliberately do not confirm the trip or invoke Stripe holds/notifications.
  RETURN jsonb_build_object('state',CASE WHEN p.state IN ('cancelled','failed','reconciliation_required') THEN 'reconciliation_required' ELSE 'paid' END,'depositStatus',deposit_state,'bookingConfirmed',false);
END; $$;
