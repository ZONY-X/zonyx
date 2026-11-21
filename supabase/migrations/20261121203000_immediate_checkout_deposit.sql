-- New checkouts authorize the deposit immediately, including advance rentals.
-- No historical reservation, payment, agreement or existing hold is rewritten.
DO $migration$
DECLARE definition text; first_marker text; last_marker text; first_at integer; last_at integer;
BEGIN
 definition:=pg_get_functiondef('public.finalize_paypal_rental_payment(uuid,text,text,bigint,text,text)'::regprocedure);
 first_marker:='  IF public.paypal_trip_inspection_deadline(p.booking_id)>now()+interval ''71 hours''';
 last_marker:='  RETURN jsonb_build_object(''state'',CASE';
 first_at:=strpos(definition,first_marker); last_at:=strpos(definition,last_marker);
 IF first_at=0 OR last_at<=first_at THEN RAISE EXCEPTION 'Capture finalizer changed; review required'; END IF;
 EXECUTE substring(definition FROM 1 FOR first_at-1)||substring(definition FROM last_at);

 definition:=pg_get_functiondef('public.prepare_paypal_sandbox_deposit(uuid)'::regprocedure);
 first_marker:='IF d.authorization_due_at>now() THEN RAISE EXCEPTION ''Security deposit will be requested closer to pickup''; END IF; ';
 IF strpos(definition,first_marker)=0 THEN RAISE EXCEPTION 'Deposit preparation changed; review required'; END IF;
 EXECUTE replace(definition,first_marker,'');

 definition:=pg_get_functiondef('public.protect_provider_payment_booking()'::regprocedure);
 first_marker:='AND EXISTS(SELECT 1 FROM public.booking_security_deposits d WHERE d.rental_payment_id=p.id AND d.captured_amount_cents=0 AND ((d.status=''authorized''';
 first_at:=strpos(definition,first_marker);
 last_at:=strpos(substring(definition FROM first_at),' THEN RETURN NEW; END IF;');
 IF first_at=0 OR last_at=0 THEN RAISE EXCEPTION 'Confirmation guard changed; review required'; END IF;
 -- Only the pending_payment -> confirmed branch changes. Handover checks remain.
 EXECUTE substring(definition FROM 1 FOR first_at-1)||
 'AND EXISTS(SELECT 1 FROM public.booking_security_deposits d WHERE d.rental_payment_id=p.id AND d.status=''authorized'' AND d.operation_state=''complete'' AND d.provider_authorization_id IS NOT NULL AND d.captured_amount_cents=0 AND d.expires_at>now())'||
 substring(definition FROM first_at+last_at-1);

 definition:=pg_get_functiondef('public.record_paypal_sandbox_authorization(uuid,text,text,bigint,text,timestamptz,timestamptz)'::regprocedure);
 first_marker:='IF b.trip_status=''pending_payment'' AND honor_end>now() AND ((b.end_date::timestamp+COALESCE(b.dropoff_time,time ''00:00'')) AT TIME ZONE ''America/New_York'') + interval ''1 day'' <= honor_end THEN';
 IF strpos(definition,first_marker)=0 THEN RAISE EXCEPTION 'Authorization recorder changed; review required'; END IF;
 definition:=replace(definition,first_marker,'IF b.trip_status=''pending_payment'' AND _expires_at>now() THEN');
 definition:=replace(definition,'SET provider_authorization_id=_authorization_id,','SET authorization_due_at=NULL,provider_authorization_id=_authorization_id,');
 EXECUTE definition;
END; $migration$;

CREATE OR REPLACE FUNCTION public.get_paypal_rental_payment_receipt(_booking_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT public.get_paypal_rental_payment_receipt_before_deferred(_booking_id)||jsonb_build_object(
  'depositScheduled',false,'depositDueAt',NULL,
  'depositAuthorizationId',d.provider_authorization_id,'depositExpiresAt',d.expires_at,
  'bookingConfirmed',b.trip_status='confirmed' AND p.state='paid' AND p.capture_id IS NOT NULL AND p.paid_at IS NOT NULL
   AND d.status='authorized' AND d.operation_state='complete' AND d.provider_authorization_id IS NOT NULL
   AND d.captured_amount_cents=0 AND d.expires_at>now()
   AND NOT EXISTS(SELECT 1 FROM paypal_booking_operations o WHERE o.payment_id=p.id),
  'pickupReady',COALESCE((public.get_paypal_rental_payment_receipt_before_deferred(_booking_id)->>'bookingConfirmed')::boolean,false)
 )
 FROM bookings b JOIN booking_payments p ON p.booking_id=b.id AND p.provider='paypal'
 LEFT JOIN booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1 WHERE b.id=_booking_id;
$$;
REVOKE ALL ON FUNCTION public.get_paypal_rental_payment_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_paypal_rental_payment_receipt(uuid) TO authenticated,service_role;
