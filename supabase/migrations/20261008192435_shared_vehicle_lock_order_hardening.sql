-- Consistent booking -> payment -> vehicle lock ordering; no release/backfill.
CREATE OR REPLACE FUNCTION public.ensure_shared_vehicle_payment_claim(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE; b public.bookings%ROWTYPE; c public.vehicle_payment_claims%ROWTYPE; span tsrange;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM public.bookings b0 JOIN public.booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
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
CREATE OR REPLACE FUNCTION public.guard_shared_vehicle_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.vehicle_payment_claims WHERE booking_id=OLD.id) AND
  (NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.pickup_time IS DISTINCT FROM OLD.pickup_time OR NEW.dropoff_time IS DISTINCT FROM OLD.dropoff_time OR NEW.grand_total_cents IS DISTINCT FROM OLD.grand_total_cents OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.renter_profile_id IS DISTINCT FROM OLD.renter_profile_id OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents OR NEW.service_fee_cents IS DISTINCT FROM OLD.service_fee_cents OR NEW.taxes_cents IS DISTINCT FROM OLD.taxes_cents OR NEW.host_profile_id IS DISTINCT FROM OLD.host_profile_id OR NEW.pickup_location IS DISTINCT FROM OLD.pickup_location OR NEW.dropoff_location IS DISTINCT FROM OLD.dropoff_location OR NEW.fulfillment_method IS DISTINCT FROM OLD.fulfillment_method) THEN RAISE EXCEPTION 'Shared payment reservation terms are locked'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.claim_sandbox_stripe_dispatch(_payment_id uuid) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM public.bookings b0 JOIN public.booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
 IF p.provider<>'stripe' OR p.environment<>'sandbox' THEN RAISE EXCEPTION 'Sandbox Stripe payment required'; END IF;
 PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
 IF p.stripe_create_started_at IS NOT NULL OR p.order_id IS NOT NULL THEN RETURN false; END IF;
 UPDATE public.booking_payments SET stripe_create_started_at=now(),state='creating' WHERE id=p.id;
 RETURN true;
END; $$;
CREATE OR REPLACE FUNCTION public.attach_sandbox_stripe_session(_payment_id uuid,_session_id text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM public.bookings b0 JOIN public.booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
 IF p.provider<>'stripe' OR p.environment<>'sandbox' OR _session_id NOT LIKE 'cs_test_%' OR (p.order_id IS NOT NULL AND p.order_id<>_session_id) THEN RAISE EXCEPTION 'Sandbox Stripe session identity conflicts'; END IF;
 PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
 UPDATE public.booking_payments SET order_id=_session_id,state=CASE WHEN state='paid' THEN state ELSE 'awaiting_approval' END WHERE id=p.id;
 UPDATE public.bookings SET stripe_checkout_session_id=_session_id WHERE id=p.booking_id;
END; $$;
CREATE OR REPLACE FUNCTION public.finalize_sandbox_stripe_payment(_payment_id uuid,_session_id text,_capture_id text,_amount_cents bigint,_currency text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM public.bookings b0 JOIN public.booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
 IF p.provider<>'stripe' OR p.environment<>'sandbox' OR p.order_id IS DISTINCT FROM _session_id OR _session_id NOT LIKE 'cs_test_%' OR _capture_id IS NULL OR _capture_id NOT LIKE 'pi_%' OR p.amount_cents IS DISTINCT FROM _amount_cents OR p.currency IS DISTINCT FROM _currency OR (p.capture_id IS NOT NULL AND p.capture_id<>_capture_id) THEN RAISE EXCEPTION 'Sandbox Stripe settlement evidence conflicts'; END IF;
 PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
 UPDATE public.booking_payments SET state='paid',capture_id=_capture_id,paid_at=COALESCE(paid_at,now()) WHERE id=p.id;
 -- No trip confirmation, deposit authorization, refund or other provider call.
END; $$;