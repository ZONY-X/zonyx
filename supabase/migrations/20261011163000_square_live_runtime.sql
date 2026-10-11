-- Install production support only. Edge release, eligibility and operation gates remain OFF.
-- Existing sandbox preparation retains its original signature and internal-tester checks.

CREATE OR REPLACE FUNCTION public.reserve_rental_payment_provider(_booking_id uuid,_agreement_id uuid,_provider text,_user_id uuid,_environment text)
RETURNS public.booking_payments LANGUAGE plpgsql SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; p public.booking_payments%ROWTYPE; s jsonb;
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF _provider NOT IN ('stripe','paypal','square') OR _environment NOT IN ('sandbox','live') THEN RAISE EXCEPTION 'Unsupported provider configuration'; END IF;
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
  IF _provider IN ('paypal','square') AND (b.stripe_checkout_session_id IS NOT NULL OR b.stripe_customer_id IS NOT NULL OR b.authorization_hold_payment_intent_id IS NOT NULL) THEN RAISE EXCEPTION 'Existing Stripe transaction cannot become PayPal'; END IF;
  INSERT INTO public.booking_payments(booking_id,agreement_id,provider,environment,amount_cents,currency,state)
    VALUES(b.id,a.id,_provider,_environment,b.grand_total_cents,b.currency,CASE WHEN _provider IN ('paypal','square') THEN 'creating' ELSE 'awaiting_approval' END) RETURNING * INTO p;
  PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
    RETURN p;
END; $$;

CREATE OR REPLACE FUNCTION public.prepare_square_live_payment(_booking_id uuid,_agreement_id uuid,_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; a booking_rental_agreements%ROWTYPE; existed boolean;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings WHERE id=_booking_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM booking_payments WHERE booking_id=_booking_id) INTO existed;
 SELECT * INTO a FROM booking_rental_agreements WHERE id=_agreement_id;
 IF a.document_hash IS NULL OR (a.trip_financial_summary->>'internal_test') IS DISTINCT FROM 'false' OR a.guest_auth_user_id IS DISTINCT FROM _user_id THEN RAISE EXCEPTION 'Accepted customer Square terms required'; END IF;
 IF paypal_trip_inspection_deadline(_booking_id) NOT BETWEEN now() AND now()+interval '167 hours' THEN RAISE EXCEPTION 'Square deposit coverage insufficient'; END IF;
 p:=reserve_rental_payment_provider(_booking_id,_agreement_id,'square',_user_id,'live');
 IF existed THEN RETURN jsonb_build_object('payment',to_jsonb(p),'dispatch',false); END IF;
 IF (a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint<=0 OR (a.trip_financial_summary->>'authorization_hold_amount_cents') IS NULL THEN RAISE EXCEPTION 'Accepted deposit required'; END IF;
 INSERT INTO booking_security_deposits(booking_id,rental_payment_id,provider,amount_cents,status,operation_state)
 VALUES(p.booking_id,p.id,'square',(a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint,'approval_required','authorizing') RETURNING * INTO d;
 INSERT INTO square_payment_operations(payment_id,hold_started) VALUES(p.id,true);
 RETURN jsonb_build_object('payment',to_jsonb(p),'deposit',to_jsonb(d),'dispatch',true);
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
 IF p.provider IS DISTINCT FROM 'square' OR p.environment NOT IN ('sandbox','live') OR g.id IS DISTINCT FROM b.renter_profile_id THEN RAISE EXCEPTION 'Square booking owner required'; END IF;
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

CREATE OR REPLACE FUNCTION public.record_square_payment(_payment_id uuid,_hold boolean,_provider_id text,_status text,_amount bigint,_expires timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; o square_payment_operations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings b JOIN booking_payments p0 ON p0.booking_id=b.id WHERE p0.id=_payment_id FOR UPDATE OF b;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 IF p.provider IS DISTINCT FROM 'square' OR p.environment NOT IN ('sandbox','live') OR NULLIF(_provider_id,'') IS NULL OR _amount IS DISTINCT FROM (CASE WHEN _hold THEN d.amount_cents ELSE p.amount_cents END) THEN RAISE EXCEPTION 'Square evidence conflicts'; END IF;
 IF _hold THEN
  IF NOT o.hold_started OR (d.provider_authorization_id IS NOT NULL AND d.provider_authorization_id<>_provider_id) THEN RAISE EXCEPTION 'Square hold identity conflicts'; END IF;
  IF d.status IN ('voided','failed','expired') AND _status='APPROVED' THEN RETURN; END IF;
  UPDATE booking_security_deposits SET provider_authorization_id=_provider_id,provider_order_id=_provider_id,
   status=CASE _status WHEN 'APPROVED' THEN 'authorized' WHEN 'CANCELED' THEN 'voided' WHEN 'FAILED' THEN 'failed' ELSE 'capability_verification_required' END,
   operation_state='complete',expires_at=_expires,honor_period_ends_at=_expires WHERE id=d.id;
  IF _status NOT IN ('APPROVED','CANCELED','FAILED') THEN UPDATE booking_payments SET state='reconciliation_required' WHERE id=p.id; END IF;
 ELSE
  IF NOT o.rental_started OR (p.order_id IS NOT NULL AND p.order_id<>_provider_id) THEN RAISE EXCEPTION 'Square rental identity conflicts'; END IF;
  UPDATE booking_payments SET order_id=_provider_id,capture_id=CASE WHEN _status='COMPLETED' THEN _provider_id ELSE capture_id END,
   paid_at=CASE WHEN _status='COMPLETED' THEN COALESCE(paid_at,now()) ELSE paid_at END,
   state=CASE WHEN state='cancelled' THEN 'cancelled' WHEN _status='COMPLETED' THEN 'paid' WHEN _status IN ('FAILED','CANCELED') AND paid_at IS NULL THEN 'failed' ELSE 'reconciliation_required' END WHERE id=p.id;
 END IF;
 -- Confirmation is deliberately withheld in this preparation, even in sandbox.
 -- Eligibility, complete browser evidence and release review precede enabling it.
END; $$;

CREATE OR REPLACE FUNCTION public.square_confirmation_ready(_booking_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM booking_payments p
 JOIN bookings b ON b.id=p.booking_id
 JOIN booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1
 JOIN square_payment_operations o ON o.payment_id=p.id
 JOIN vehicles v ON v.id=b.vehicle_id
 JOIN driver_eligibility e ON e.profile_id=b.renter_profile_id
 WHERE b.id=_booking_id AND (current_setting('role',true)='service_role' OR EXISTS(SELECT 1 FROM profiles g WHERE g.user_id=auth.uid() AND (g.id IN (b.renter_profile_id,b.host_profile_id) OR g.is_admin))) AND p.provider='square' AND p.environment IN ('sandbox','live')
 AND EXISTS(SELECT 1 FROM booking_rental_agreements a WHERE a.id=p.agreement_id AND a.trip_financial_summary->>'internal_test'=CASE WHEN p.environment='live' THEN 'false' ELSE 'true' END)
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

CREATE OR REPLACE FUNCTION public.reconcile_square_booking(_payment_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; b bookings%ROWTYPE; d booking_security_deposits%ROWTYPE; o square_payment_operations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings b0 JOIN booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id AND provider='square' AND environment IN ('sandbox','live') FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Square payment required'; END IF;
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
REVOKE ALL ON FUNCTION public.prepare_square_live_payment(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_square_live_payment(uuid,uuid,uuid) TO service_role;
