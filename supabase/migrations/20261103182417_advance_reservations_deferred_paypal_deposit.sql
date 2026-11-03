-- Rental capture reserves future inventory. Deposit authorization is a separate
-- pre-pickup obligation; the existing verified-deposit gate to active is intact.
ALTER TABLE public.booking_security_deposits ADD COLUMN authorization_due_at timestamptz;

CREATE OR REPLACE FUNCTION public.paypal_card_checkout_preflight(_booking_id uuid) RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE deadline timestamptz; hold bigint;
BEGIN
 deadline:=paypal_trip_inspection_deadline(_booking_id);
 SELECT (a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint INTO hold
 FROM booking_rental_agreements a WHERE a.booking_id=_booking_id AND a.accepted_at IS NOT NULL
 ORDER BY a.accepted_at DESC LIMIT 1;
 IF deadline IS NULL OR deadline<=now() OR COALESCE(hold,0)<=0 THEN RAISE EXCEPTION 'Valid future rental dates and accepted deposit terms required'; END IF;
 RETURN deadline;
END; $$;

-- Change only the confirmation branch, never the transition to active/pickup.
DO $migration$
DECLARE definition text; old_check text; new_check text;
BEGIN
 definition:=pg_get_functiondef('public.protect_provider_payment_booking()'::regprocedure);
 old_check:='AND EXISTS(SELECT 1 FROM public.booking_security_deposits d WHERE d.rental_payment_id=p.id AND d.status=''authorized'' AND d.operation_state=''complete'' AND d.provider_authorization_id IS NOT NULL AND d.captured_amount_cents=0 AND d.honor_period_ends_at>now() AND ((NEW.end_date::timestamp+COALESCE(NEW.dropoff_time,time ''00:00'')) AT TIME ZONE ''America/New_York'')+interval ''1 day''<=d.honor_period_ends_at)';
 new_check:='AND EXISTS(SELECT 1 FROM public.booking_security_deposits d WHERE d.rental_payment_id=p.id AND d.captured_amount_cents=0 AND ((d.status=''authorized'' AND d.operation_state=''complete'' AND d.provider_authorization_id IS NOT NULL AND d.honor_period_ends_at>now() AND public.paypal_trip_inspection_deadline(NEW.id)<=d.honor_period_ends_at) OR (d.authorization_due_at IS NOT NULL AND d.provider_authorization_id IS NULL AND d.operation_state=''idle'' AND p.capture_id IS NOT NULL AND p.paid_at IS NOT NULL AND ((NEW.start_date::timestamp+COALESCE(NEW.pickup_time,time ''00:00'')) AT TIME ZONE ''America/New_York'')>now())))';
 IF strpos(definition,old_check)=0 THEN RAISE EXCEPTION 'Confirmation guard definition changed'; END IF;
 EXECUTE replace(definition,old_check,new_check);
END; $migration$;

-- Preserve the audited capture finalizer and its one-winner inventory claim.
DO $migration$
DECLARE definition text; marker text;
BEGIN
 definition:=pg_get_functiondef('public.finalize_paypal_rental_payment(uuid,text,text,bigint,text,text)'::regprocedure);
 marker:='-- Deliberately do not confirm the trip or invoke Stripe holds/notifications.';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'Capture finalizer changed'; END IF;
 definition:=replace(definition,marker,$replacement$
  IF public.paypal_trip_inspection_deadline(p.booking_id)>now()+interval '71 hours'
     AND EXISTS(SELECT 1 FROM booking_payments WHERE id=p.id AND state='paid' AND capture_id=_capture_id AND paid_at IS NOT NULL)
     AND EXISTS(SELECT 1 FROM bookings WHERE id=p.booking_id AND trip_status='pending_payment' AND ((start_date::timestamp+COALESCE(pickup_time,time '00:00')) AT TIME ZONE 'America/New_York')>now()) THEN
    UPDATE booking_security_deposits SET authorization_due_at=least(
      public.paypal_trip_inspection_deadline(p.booking_id)-interval '71 hours',
      (SELECT ((start_date::timestamp+COALESCE(pickup_time,time '00:00')) AT TIME ZONE 'America/New_York')-interval '1 hour' FROM bookings WHERE id=p.booking_id)
    ) WHERE rental_payment_id=p.id AND generation=1 AND provider_authorization_id IS NULL AND operation_state='idle';
    UPDATE bookings SET trip_status='confirmed' WHERE id=p.booking_id;
    RETURN public.get_provider_rental_payment_receipt(p.booking_id);
  END IF;
  IF EXISTS(SELECT 1 FROM booking_security_deposits WHERE rental_payment_id=p.id AND authorization_due_at IS NOT NULL) THEN
    RETURN public.get_provider_rental_payment_receipt(p.booking_id);
  END IF;
$replacement$);
 EXECUTE definition;
END; $migration$;

-- Existing PayPal and Square receipt logic remains the source of pickup truth.
ALTER FUNCTION public.get_paypal_rental_payment_receipt(uuid) RENAME TO get_paypal_rental_payment_receipt_before_deferred;
CREATE FUNCTION public.get_paypal_rental_payment_receipt(_booking_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT r.receipt || jsonb_build_object(
   'pickupReady',COALESCE((r.receipt->>'bookingConfirmed')::boolean,false),
   'depositScheduled',d.authorization_due_at IS NOT NULL AND d.provider_authorization_id IS NULL,
   'depositDueAt',d.authorization_due_at,
   'bookingConfirmed',COALESCE((r.receipt->>'bookingConfirmed')::boolean,false) OR
      (b.trip_status='confirmed' AND p.state='paid' AND p.capture_id IS NOT NULL AND p.paid_at IS NOT NULL
       AND d.authorization_due_at IS NOT NULL AND d.captured_amount_cents=0
       AND NOT EXISTS(SELECT 1 FROM paypal_booking_operations o WHERE o.payment_id=p.id))
 )
 FROM bookings b JOIN booking_payments p ON p.booking_id=b.id AND p.provider='paypal'
 JOIN booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1
 CROSS JOIN LATERAL (SELECT public.get_paypal_rental_payment_receipt_before_deferred(_booking_id) AS receipt) r
 WHERE b.id=_booking_id;
$$;
REVOKE ALL ON FUNCTION public.get_paypal_rental_payment_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_paypal_rental_payment_receipt(uuid) TO authenticated,service_role;

-- Do not create a short-lived authorization months before the trip.
DO $migration$
DECLARE definition text; marker text;
BEGIN
 definition:=pg_get_functiondef('public.prepare_paypal_sandbox_deposit(uuid)'::regprocedure);
 marker:='IF d.operation_state=''idle'' AND d.status IN (''disabled'',''capability_verification_required'') THEN';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'Deposit preparation changed'; END IF;
 EXECUTE replace(definition,marker,'IF d.authorization_due_at>now() THEN RAISE EXCEPTION ''Security deposit will be requested closer to pickup''; END IF; '||marker);
END; $migration$;

-- The owner's booking page must retain the path to complete the later deposit.
CREATE OR REPLACE FUNCTION public.get_my_pending_payment_links()
RETURNS TABLE(booking_id uuid,agreement_id uuid) LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
 SELECT DISTINCT ON (b.id) b.id,a.id FROM bookings b
 JOIN booking_rental_agreements a ON a.booking_id=b.id AND a.accepted_at IS NOT NULL
 WHERE auth.uid() IS NOT NULL AND b.renter_profile_id=current_profile_id()
 AND (b.trip_status='pending_payment' OR (b.trip_status='confirmed' AND EXISTS(
   SELECT 1 FROM booking_payments p JOIN booking_security_deposits d ON d.rental_payment_id=p.id
   WHERE p.booking_id=b.id AND p.provider='paypal' AND p.state='paid' AND d.authorization_due_at IS NOT NULL AND d.status<>'authorized')))
 ORDER BY b.id,a.accepted_at DESC;
$$;
