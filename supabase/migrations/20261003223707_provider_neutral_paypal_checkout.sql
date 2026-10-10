-- Additive only. No backfill, production data changes, or external API calls.
-- One durable rental payment per booking, extensible provider names, separate
-- deposit lifecycle. Existing Stripe columns and historical ledger remain intact.
CREATE TABLE public.booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  agreement_id uuid NOT NULL REFERENCES public.booking_rental_agreements(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]*$'),
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 50),
  currency text NOT NULL CHECK (currency = 'usd'),
  state text NOT NULL CHECK (state IN ('creating','awaiting_approval','capturing','paid','failed','cancelled','reconciliation_required')),
  order_id text,
  capture_id text,
  approval_url text,
  create_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  capture_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  capture_started_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,environment,order_id), UNIQUE(provider,environment,capture_id)
);
CREATE INDEX booking_payments_agreement_idx ON public.booking_payments(agreement_id);
CREATE TABLE public.booking_security_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  rental_payment_id uuid NOT NULL REFERENCES public.booking_payments(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  intent text NOT NULL DEFAULT 'AUTHORIZE' CHECK (intent='AUTHORIZE'),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled','capability_verification_required','approval_required','authorized','renewal_required','expired','voided','partially_captured','captured','failed')),
  provider_order_id text,
  provider_authorization_id text,
  authorized_at timestamptz,
  honor_period_ends_at timestamptz,
  expires_at timestamptz,
  renew_after timestamptz,
  captured_amount_cents bigint NOT NULL DEFAULT 0 CHECK (captured_amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id,generation), UNIQUE(provider,provider_authorization_id)
);
CREATE INDEX booking_security_deposits_payment_idx ON public.booking_security_deposits(rental_payment_id);
CREATE TABLE public.payment_webhook_receipts (
  provider text NOT NULL,
  environment text NOT NULL,
  event_id text NOT NULL,
  payment_id uuid NOT NULL REFERENCES public.booking_payments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,environment,event_id)
);
CREATE INDEX payment_webhook_receipts_payment_idx ON public.payment_webhook_receipts(payment_id);
ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_security_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_payments,public.booking_security_deposits,public.payment_webhook_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.booking_payments,public.booking_security_deposits,public.payment_webhook_receipts TO service_role;
GRANT SELECT ON public.booking_payments,public.booking_security_deposits TO authenticated;
CREATE POLICY rental_payment_read ON public.booking_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=booking_id AND (b.renter_profile_id=public.current_profile_id() OR public.current_profile_is_admin())));
CREATE POLICY deposit_payment_read ON public.booking_security_deposits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=booking_id AND (b.renter_profile_id=public.current_profile_id() OR public.current_profile_is_admin())));

-- SECURITY INVOKER, only service_role may execute. User identity is supplied by
-- the authenticated Edge Function, never by a direct authenticated-role RPC.
CREATE FUNCTION public.reserve_rental_payment_provider(_booking_id uuid,_agreement_id uuid,_provider text,_user_id uuid,_environment text)
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
    RETURN p;
  END IF;
  IF b.trip_status<>'pending_payment' THEN RAISE EXCEPTION 'Booking is not pending payment'; END IF;
  IF _provider='paypal' AND (b.stripe_checkout_session_id IS NOT NULL OR b.stripe_customer_id IS NOT NULL OR b.authorization_hold_payment_intent_id IS NOT NULL) THEN RAISE EXCEPTION 'Existing Stripe transaction cannot become PayPal'; END IF;
  INSERT INTO public.booking_payments(booking_id,agreement_id,provider,environment,amount_cents,currency,state)
    VALUES(b.id,a.id,_provider,_environment,b.grand_total_cents,b.currency,CASE WHEN _provider='paypal' THEN 'creating' ELSE 'awaiting_approval' END) RETURNING * INTO p;
  RETURN p;
END; $$;

CREATE FUNCTION public.prepare_paypal_rental_payment(_booking_id uuid,_agreement_id uuid,_user_id uuid,_environment text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE; existed boolean;
BEGIN
  PERFORM 1 FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM public.booking_payments WHERE booking_id=_booking_id) INTO existed;
  IF NOT EXISTS(SELECT 1 FROM public.booking_rental_agreements a JOIN public.profiles g ON g.id=a.guest_profile_id WHERE a.id=_agreement_id AND a.guest_auth_user_id=_user_id AND a.trip_financial_summary->>'internal_test'='true' AND (g.is_internal_tester OR g.is_admin)) THEN RAISE EXCEPTION 'Internal testing required'; END IF;
  p:=public.reserve_rental_payment_provider(_booking_id,_agreement_id,'paypal',_user_id,_environment);
  RETURN jsonb_build_object('payment',to_jsonb(p),'dispatch',NOT existed);
END; $$;
CREATE FUNCTION public.attach_paypal_rental_order(_payment_id uuid,_order_id text,_approval_url text)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  UPDATE public.booking_payments SET order_id=_order_id,approval_url=_approval_url,state='awaiting_approval',updated_at=now()
    WHERE id=_payment_id AND provider='paypal' AND state='creating' AND order_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order claim is no longer eligible'; END IF;
END; $$;
CREATE FUNCTION public.claim_paypal_rental_capture(_payment_id uuid,_user_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE; b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE;
BEGIN
  SELECT b0.* INTO b FROM public.bookings b0 JOIN public.booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
  SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
  IF p.id IS NULL OR p.provider<>'paypal' OR p.state<>'awaiting_approval' OR p.order_id IS NULL OR p.capture_started_at IS NOT NULL OR b.trip_status<>'pending_payment' THEN RAISE EXCEPTION 'Capture already claimed or booking ineligible'; END IF;
  a:=(SELECT a0 FROM public.booking_rental_agreements a0 WHERE a0.id=p.agreement_id);
  PERFORM public.reserve_rental_payment_provider(b.id,p.agreement_id,'paypal',_user_id,p.environment);
  IF p.amount_cents IS DISTINCT FROM (a.trip_financial_summary->>'final_total_cents')::bigint THEN RAISE EXCEPTION 'Accepted amount changed'; END IF;
  -- Serialize PayPal captures for this vehicle, then recheck operational truth.
  PERFORM pg_advisory_xact_lock(hashtextextended(b.vehicle_id::text,0));
  IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id AND (x.trip_status IN ('confirmed','active','pending_inspection','completed') OR EXISTS(SELECT 1 FROM public.booking_payments xp WHERE xp.booking_id=x.id AND xp.provider='paypal' AND xp.state IN ('capturing','paid','reconciliation_required'))) AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)') && tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')) THEN RAISE EXCEPTION 'Booking availability changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')) THEN RAISE EXCEPTION 'Vehicle blocked'; END IF;
  UPDATE public.booking_payments SET state='capturing',capture_started_at=now(),updated_at=now() WHERE id=p.id;
END; $$;
CREATE FUNCTION public.record_paypal_payment_state(_payment_id uuid,_state text)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.bookings b JOIN public.booking_payments x ON x.booking_id=b.id WHERE x.id=_payment_id FOR UPDATE OF b;
  SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id AND provider='paypal' FOR UPDATE;
  IF NOT FOUND OR _state NOT IN ('failed','cancelled','reconciliation_required') THEN RAISE EXCEPTION 'Invalid payment transition'; END IF;
  IF _state='cancelled' AND p.state NOT IN ('awaiting_approval','cancelled') THEN RAISE EXCEPTION 'Capture outcome must be reconciled before cancellation'; END IF;
  IF _state='failed' AND p.paid_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.booking_payments SET state=_state,updated_at=now() WHERE id=p.id;
END; $$;
CREATE FUNCTION public.finalize_paypal_rental_payment(_payment_id uuid,_order_id text,_capture_id text,_amount_cents bigint,_currency text,_deposit_status text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; deposit_state text;
BEGIN
  PERFORM 1 FROM public.bookings b JOIN public.booking_payments x ON x.booking_id=b.id WHERE x.id=_payment_id FOR UPDATE OF b;
  SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id AND provider='paypal' FOR UPDATE;
  IF NOT FOUND OR p.order_id IS DISTINCT FROM _order_id OR p.amount_cents IS DISTINCT FROM _amount_cents OR p.currency IS DISTINCT FROM _currency OR NULLIF(_capture_id,'') IS NULL THEN RAISE EXCEPTION 'Capture integrity failure'; END IF;
  IF p.capture_id IS NOT NULL AND p.capture_id<>_capture_id THEN RAISE EXCEPTION 'Duplicate capture identity'; END IF;
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

-- Protect neutral payments from legacy direct updates or operational actions.
CREATE FUNCTION public.protect_provider_payment_booking() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.booking_payments WHERE booking_id=OLD.id AND provider='paypal';
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id OR NEW.stripe_payment_method_id IS DISTINCT FROM OLD.stripe_payment_method_id OR NEW.authorization_hold_payment_intent_id IS DISTINCT FROM OLD.authorization_hold_payment_intent_id THEN RAISE EXCEPTION 'PayPal payment cannot use Stripe identifiers'; END IF;
  IF ROW(NEW.subtotal_cents,NEW.service_fee_cents,NEW.taxes_cents,NEW.grand_total_cents,NEW.currency,NEW.vehicle_id,NEW.start_date,NEW.end_date,NEW.pickup_time,NEW.dropoff_time,NEW.renter_profile_id,NEW.host_profile_id,NEW.pickup_location,NEW.dropoff_location,NEW.fulfillment_method) IS DISTINCT FROM ROW(OLD.subtotal_cents,OLD.service_fee_cents,OLD.taxes_cents,OLD.grand_total_cents,OLD.currency,OLD.vehicle_id,OLD.start_date,OLD.end_date,OLD.pickup_time,OLD.dropoff_time,OLD.renter_profile_id,OLD.host_profile_id,OLD.pickup_location,OLD.dropoff_location,OLD.fulfillment_method) THEN RAISE EXCEPTION 'PayPal reservation financial and schedule terms are locked'; END IF;
  IF NEW.trip_status IS DISTINCT FROM OLD.trip_status THEN
    -- No PayPal booking may become operational in this internal-only release.
    IF NEW.trip_status IN ('confirmed','active','pending_inspection','completed') OR p.state IN ('capturing','paid','reconciliation_required') THEN RAISE EXCEPTION 'PayPal booking requires verified deposit lifecycle or payment reconciliation'; END IF;
    UPDATE public.booking_payments SET state='cancelled',updated_at=now() WHERE id=p.id AND state IN ('creating','awaiting_approval');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_provider_payment_booking BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.protect_provider_payment_booking();
REVOKE ALL ON FUNCTION public.protect_provider_payment_booking() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.reserve_rental_payment_provider(uuid,uuid,text,uuid,text),public.prepare_paypal_rental_payment(uuid,uuid,uuid,text),public.attach_paypal_rental_order(uuid,text,text),public.claim_paypal_rental_capture(uuid,uuid),public.record_paypal_payment_state(uuid,text),public.finalize_paypal_rental_payment(uuid,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_rental_payment_provider(uuid,uuid,text,uuid,text),public.prepare_paypal_rental_payment(uuid,uuid,uuid,text),public.attach_paypal_rental_order(uuid,text,text),public.claim_paypal_rental_capture(uuid,uuid),public.record_paypal_payment_state(uuid,text),public.finalize_paypal_rental_payment(uuid,text,text,bigint,text,text) TO service_role;

-- Read adapter exposes durable receipts without rewriting the historical Stripe
-- financial ledger or pretending an externally reversed capture is settled.
CREATE FUNCTION public.get_provider_rental_payment_receipt(_booking_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT jsonb_build_object('provider',p.provider,'state',p.state,
    'amountCents',p.amount_cents,'capturedAmountCents',CASE WHEN p.paid_at IS NOT NULL THEN p.amount_cents ELSE 0 END,
    'currency',p.currency,'depositStatus',COALESCE(d.status,'not_started'),
    'reconciliationRequired',p.state='reconciliation_required','bookingConfirmed',false)
  FROM public.booking_payments p LEFT JOIN public.booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1
  WHERE p.booking_id=_booking_id AND p.provider='paypal';
$$;
REVOKE ALL ON FUNCTION public.get_provider_rental_payment_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_provider_rental_payment_receipt(uuid) TO authenticated,service_role;
