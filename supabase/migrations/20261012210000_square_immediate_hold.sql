-- Immediate Square deposit HOLD for every reservation; Square limits the authorization window, so no deferred scheduling remains.
CREATE OR REPLACE FUNCTION public.claim_square_deposit_attempt(_payment_id uuid,_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; b bookings%ROWTYPE; o square_payment_operations%ROWTYPE; d booking_security_deposits%ROWTYPE; h square_deposit_attempts%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 SELECT b0.* INTO b FROM bookings b0 JOIN booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 IF p.provider IS DISTINCT FROM 'square' OR p.environment IS DISTINCT FROM 'live' OR o.checkout_sequence IS DISTINCT FROM 'rental_then_hold'
 OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=b.renter_profile_id AND user_id=_user_id) THEN RAISE EXCEPTION 'Square booking owner required'; END IF;
 IF o.cancel_requested OR b.trip_status<>'pending_payment' OR p.state<>'paid' OR p.paid_at IS NULL OR p.capture_id IS NULL THEN RAISE EXCEPTION 'Verified rental payment required before deposit'; END IF;
 IF o.current_hold_attempt IS NOT NULL THEN
  SELECT * INTO h FROM square_deposit_attempts WHERE id=o.current_hold_attempt FOR UPDATE;
  IF h.state<>'failed' THEN RETURN jsonb_build_object('attempt',to_jsonb(h),'dispatch',false); END IF;
 END IF;
 IF paypal_trip_inspection_deadline(b.id)<=now() THEN RAISE EXCEPTION 'Reservation inspection window has ended'; END IF;
 PERFORM ensure_shared_vehicle_payment_claim(p.id);
 INSERT INTO square_deposit_attempts(payment_id) VALUES(p.id) RETURNING * INTO h;
 UPDATE square_payment_operations SET hold_started=true,current_hold_attempt=h.id,void_started=false WHERE payment_id=p.id;
 UPDATE booking_security_deposits SET status='approval_required',operation_state='authorizing',provider_authorization_id=NULL,provider_order_id=NULL,expires_at=NULL,honor_period_ends_at=NULL WHERE id=d.id;
 RETURN jsonb_build_object('attempt',to_jsonb(h),'dispatch',true);
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

 AND v.is_active AND v.availability_status='active'
 AND public.driver_eligibility_status(e.date_of_birth,e.license_expiration_date,e.self_attested_at,b.end_date)='eligible_self_attested'
 AND NOT EXISTS(SELECT 1 FROM vehicle_blocked_periods x WHERE x.vehicle_id=b.vehicle_id
 AND tsrange(x.start_at::timestamp,x.end_at::timestamp,'[)') && tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')));
$$;

