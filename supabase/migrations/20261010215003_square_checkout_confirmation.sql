-- Canonical Square evidence can confirm a sandbox booking; browser responses cannot.
CREATE FUNCTION public.square_confirmation_ready(_booking_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM booking_payments p
 JOIN bookings b ON b.id=p.booking_id
 JOIN booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1
 JOIN square_payment_operations o ON o.payment_id=p.id
 JOIN vehicles v ON v.id=b.vehicle_id
 JOIN driver_eligibility e ON e.profile_id=b.renter_profile_id
 WHERE b.id=_booking_id AND (current_setting('role',true)='service_role' OR EXISTS(SELECT 1 FROM profiles g WHERE g.user_id=auth.uid() AND (g.id IN (b.renter_profile_id,b.host_profile_id) OR g.is_admin))) AND p.provider='square' AND p.environment='sandbox'
 AND p.state='paid' AND p.paid_at IS NOT NULL AND p.capture_id IS NOT NULL
 AND NOT o.cancel_requested AND NOT o.refund_started
 AND d.status='authorized' AND d.operation_state='complete' AND d.captured_amount_cents=0
 AND d.provider_authorization_id IS NOT NULL AND d.expires_at>now()
 AND d.expires_at>=public.paypal_trip_inspection_deadline(b.id)
 AND v.is_active AND v.availability_status='active'
 AND public.driver_eligibility_status(e.date_of_birth,e.license_expiration_date,e.self_attested_at,b.end_date)='eligible_self_attested'
 AND NOT EXISTS(SELECT 1 FROM vehicle_blocked_periods x WHERE x.vehicle_id=b.vehicle_id
 AND tsrange(x.start_at::timestamp,x.end_at::timestamp,'[)') && tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')));
$$;
REVOKE ALL ON FUNCTION public.square_confirmation_ready(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.square_confirmation_ready(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.guard_square_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM booking_payments WHERE booking_id=OLD.id AND provider='square') THEN
  IF ROW(NEW.subtotal_cents,NEW.service_fee_cents,NEW.taxes_cents,NEW.grand_total_cents,NEW.currency,NEW.vehicle_id,NEW.start_date,NEW.end_date,NEW.pickup_time,NEW.dropoff_time,NEW.renter_profile_id,NEW.host_profile_id,NEW.pickup_location,NEW.dropoff_location,NEW.fulfillment_method,NEW.stripe_checkout_session_id,NEW.stripe_customer_id,NEW.stripe_payment_method_id,NEW.authorization_hold_payment_intent_id) IS DISTINCT FROM ROW(OLD.subtotal_cents,OLD.service_fee_cents,OLD.taxes_cents,OLD.grand_total_cents,OLD.currency,OLD.vehicle_id,OLD.start_date,OLD.end_date,OLD.pickup_time,OLD.dropoff_time,OLD.renter_profile_id,OLD.host_profile_id,OLD.pickup_location,OLD.dropoff_location,OLD.fulfillment_method,OLD.stripe_checkout_session_id,OLD.stripe_customer_id,OLD.stripe_payment_method_id,OLD.authorization_hold_payment_intent_id) THEN RAISE EXCEPTION 'Square booking requires verified release lifecycle'; END IF;
  IF NEW.trip_status IS DISTINCT FROM OLD.trip_status THEN
   IF NEW.trip_status='confirmed' AND OLD.trip_status='pending_payment' AND current_setting('role',true)='service_role' AND public.square_confirmation_ready(OLD.id) THEN RETURN NEW; END IF;
   IF NEW.trip_status<>'cancelled' OR current_setting('role',true)<>'service_role' OR NOT EXISTS(SELECT 1 FROM booking_payments p JOIN booking_security_deposits d ON d.rental_payment_id=p.id JOIN square_payment_operations o ON o.payment_id=p.id WHERE p.booking_id=OLD.id AND o.cancel_requested AND d.status IN ('voided','expired','failed') AND (NOT o.rental_started OR (p.state='failed' AND p.order_id IS NOT NULL AND p.paid_at IS NULL) OR (p.paid_at IS NOT NULL AND o.refund_status='COMPLETED'))) THEN RAISE EXCEPTION 'Square booking requires verified release lifecycle'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION public.reconcile_square_booking(_payment_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; b bookings%ROWTYPE; d booking_security_deposits%ROWTYPE; o square_payment_operations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings b0 JOIN booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id AND provider='square' AND environment='sandbox' FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Square sandbox payment required'; END IF;
 SELECT * INTO b FROM bookings WHERE id=p.booking_id;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 IF o.cancel_requested THEN
  IF d.status IN ('voided','expired','failed') AND (NOT o.rental_started OR (p.state='failed' AND p.order_id IS NOT NULL AND p.paid_at IS NULL) OR (p.paid_at IS NOT NULL AND o.refund_status='COMPLETED')) THEN
   PERFORM public.complete_square_cancellation(p.id);
  END IF;
 ELSIF b.trip_status='pending_payment' AND public.square_confirmation_ready(b.id) THEN
  PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
  UPDATE bookings SET trip_status='confirmed' WHERE id=b.id;
 ELSIF p.paid_at IS NOT NULL AND b.trip_status IN ('pending_payment','confirmed') AND NOT public.square_confirmation_ready(b.id) THEN
  PERFORM public.flag_square_reconciliation(p.id);
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.reconcile_square_booking(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_square_booking(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.get_provider_rental_payment_receipt(_booking_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT COALESCE((SELECT jsonb_build_object('provider',p.provider,'state',p.state,'amountCents',p.amount_cents,
 'capturedAmountCents',CASE WHEN p.paid_at IS NULL THEN 0 ELSE p.amount_cents END,'currency',p.currency,'depositStatus',d.status,
 'depositAmountCents',d.amount_cents,'depositCapturedAmountCents',d.captured_amount_cents,'tripStatus',b.trip_status,
 'refundedAmountCents',CASE WHEN o.refund_status='COMPLETED' THEN o.refund_amount_cents ELSE 0 END,'refundStatus',o.refund_status,
 'reconciliationRequired',p.state='reconciliation_required' OR (o.cancel_requested AND b.trip_status<>'cancelled'),'bookingConfirmed',b.trip_status='confirmed' AND public.square_confirmation_ready(b.id))
 FROM booking_payments p JOIN bookings b ON b.id=p.booking_id JOIN booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1
 JOIN square_payment_operations o ON o.payment_id=p.id WHERE p.booking_id=_booking_id AND p.provider='square'),get_paypal_rental_payment_receipt(_booking_id));
$$;

CREATE OR REPLACE FUNCTION public.complete_square_cancellation(_payment_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; o square_payment_operations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings b JOIN booking_payments p0 ON p0.booking_id=b.id WHERE p0.id=_payment_id FOR UPDATE OF b;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id AND provider='square' FOR UPDATE;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 IF p.id IS NULL OR NOT o.cancel_requested OR d.status NOT IN ('voided','expired','failed') OR (o.rental_started AND NOT (p.state='failed' AND p.order_id IS NOT NULL AND p.paid_at IS NULL) AND (p.paid_at IS NULL OR o.refund_status IS DISTINCT FROM 'COMPLETED')) THEN RAISE EXCEPTION 'Canonical void and refund required before cancellation'; END IF;
 UPDATE bookings SET trip_status='cancelled' WHERE id=p.booking_id;
 UPDATE booking_payments SET state='cancelled',updated_at=now() WHERE id=p.id;
 UPDATE vehicle_payment_claims SET released_at=COALESCE(released_at,now()) WHERE payment_id=p.id;
END; $$;

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
 IF EXISTS(SELECT 1 FROM public.vehicle_payment_claims x WHERE x.vehicle_id=b.vehicle_id AND x.booking_id<>b.id AND x.released_at IS NULL AND x.reserved_span && span) THEN RAISE EXCEPTION 'Shared vehicle payment reservation conflicts'; END IF;
 -- Fail closed for legacy/unknown earlier attempts, including unattached neutral
 -- payment reservations. Never import or relabel a production Stripe session.
 IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id
  AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)') && span
  AND NOT (x.trip_status='cancelled' AND EXISTS(SELECT 1 FROM booking_payments cp JOIN paypal_booking_operations o ON o.payment_id=cp.id JOIN vehicle_payment_claims vc ON vc.payment_id=cp.id WHERE cp.booking_id=x.id AND o.kind='cancel' AND o.state='complete' AND vc.released_at IS NOT NULL) OR x.trip_status='cancelled' AND EXISTS(SELECT 1 FROM booking_payments cp JOIN square_payment_operations so ON so.payment_id=cp.id JOIN vehicle_payment_claims vc ON vc.payment_id=cp.id WHERE cp.booking_id=x.id AND cp.provider='square' AND cp.state='cancelled' AND so.cancel_requested AND vc.released_at IS NOT NULL))
  AND (x.trip_status IN ('confirmed','active','pending_inspection','completed') OR x.stripe_checkout_session_id IS NOT NULL OR x.authorization_hold_payment_intent_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.booking_payments xp WHERE xp.booking_id=x.id))) THEN RAISE EXCEPTION 'Shared vehicle payment reservation conflicts'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && span) THEN RAISE EXCEPTION 'Vehicle blocked'; END IF;
 INSERT INTO public.vehicle_payment_claims(payment_id,booking_id,vehicle_id,reserved_span) VALUES(p.id,b.id,b.vehicle_id,span);
END; $$;


CREATE OR REPLACE FUNCTION public.claim_square_step(_payment_id uuid,_step text,_user_id uuid,_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; b bookings%ROWTYPE; o square_payment_operations%ROWTYPE; g profiles%ROWTYPE; dispatch boolean:=false;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 SELECT b0.* INTO b FROM bookings b0 JOIN booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 SELECT * INTO g FROM profiles WHERE user_id=_user_id;
 IF p.provider IS DISTINCT FROM 'square' OR p.environment IS DISTINCT FROM 'sandbox' OR g.id IS DISTINCT FROM b.renter_profile_id THEN RAISE EXCEPTION 'Square booking owner required'; END IF;
 IF _step='rental' AND o.rental_started THEN RETURN jsonb_build_object('payment',to_jsonb(p),'deposit',to_jsonb(d),'operation',to_jsonb(o),'dispatch',false); END IF;
 IF _step='rental' THEN
  IF o.cancel_requested OR b.trip_status<>'pending_payment' OR d.status<>'authorized' OR d.expires_at<now() OR d.expires_at<paypal_trip_inspection_deadline(b.id) THEN RAISE EXCEPTION 'Valid Square deposit required before rental'; END IF;
  PERFORM validate_vehicle_rental_duration(b.vehicle_id,b.start_date,b.pickup_time,b.end_date,b.dropoff_time);
  PERFORM ensure_shared_vehicle_payment_claim(p.id);
  IF NOT o.rental_started THEN UPDATE square_payment_operations SET rental_started=true WHERE payment_id=p.id; UPDATE booking_payments SET state='capturing',capture_started_at=now() WHERE id=p.id; dispatch:=true; END IF;
 ELSIF _step='cancel' THEN
  IF b.trip_status NOT IN ('pending_payment','confirmed','cancelled') OR length(btrim(COALESCE(_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Pre-trip cancellation and reason required'; END IF;
  IF NOT o.cancel_requested THEN
   UPDATE square_payment_operations SET cancel_requested=true,reason=btrim(_reason),refund_amount_cents=CASE WHEN b.trip_status='confirmed' THEN least(p.amount_cents,b.subtotal_cents+b.taxes_cents) ELSE p.amount_cents END WHERE payment_id=p.id;
  END IF;
 ELSIF _step='void' THEN
  IF NOT o.cancel_requested OR d.provider_authorization_id IS NULL THEN RAISE EXCEPTION 'Reconcile existing hold before void'; END IF;
  IF NOT o.void_started AND d.status='authorized' THEN UPDATE square_payment_operations SET void_started=true WHERE payment_id=p.id; dispatch:=true; END IF;
 ELSIF _step='refund' THEN
  IF NOT o.cancel_requested OR d.status NOT IN ('voided','expired','failed') OR p.capture_id IS NULL OR p.paid_at IS NULL THEN RAISE EXCEPTION 'Canonical void and rental required before refund'; END IF;
  IF NOT o.refund_started THEN UPDATE square_payment_operations SET refund_started=true WHERE payment_id=p.id; dispatch:=true; END IF;
 ELSE RAISE EXCEPTION 'Unsupported Square step'; END IF;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id;
 RETURN jsonb_build_object('payment',to_jsonb(p),'deposit',to_jsonb(d),'operation',to_jsonb(o),'dispatch',dispatch);
END; $$;

