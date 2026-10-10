-- Additive preparation only. Applying this file does not enable checkout.
CREATE FUNCTION public.paypal_trip_inspection_deadline(_booking_id uuid) RETURNS timestamptz LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT ((end_date::timestamp+COALESCE(dropoff_time,time '00:00')) AT TIME ZONE 'America/New_York')+interval '1 day' FROM bookings WHERE id=_booking_id;
$$;
REVOKE ALL ON FUNCTION public.paypal_trip_inspection_deadline(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_trip_inspection_deadline(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_paypal_rental_payment(_booking_id uuid,_agreement_id uuid,_user_id uuid,_environment text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p public.booking_payments%ROWTYPE; existed boolean;
BEGIN
 PERFORM 1 FROM bookings WHERE id=_booking_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM booking_payments WHERE booking_id=_booking_id) INTO existed;
 IF _environment='sandbox' THEN
  IF NOT EXISTS(SELECT 1 FROM booking_rental_agreements a JOIN profiles g ON g.id=a.guest_profile_id WHERE a.id=_agreement_id AND a.guest_auth_user_id=_user_id AND a.trip_financial_summary->>'internal_test'='true' AND (g.is_internal_tester OR g.is_admin)) THEN RAISE EXCEPTION 'Internal testing required'; END IF;
 ELSIF _environment='live' THEN
  IF NOT EXISTS(SELECT 1 FROM booking_rental_agreements a JOIN profiles g ON g.id=a.guest_profile_id WHERE a.id=_agreement_id AND a.guest_auth_user_id=_user_id AND a.trip_financial_summary->>'internal_test'='false' AND NOT g.is_internal_tester) THEN RAISE EXCEPTION 'Accepted customer terms required'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported environment'; END IF;
 p:=reserve_rental_payment_provider(_booking_id,_agreement_id,'paypal',_user_id,_environment);
 RETURN jsonb_build_object('payment',to_jsonb(p),'dispatch',NOT existed);
END; $$;

CREATE OR REPLACE FUNCTION public.prepare_paypal_sandbox_deposit(_payment_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE p public.booking_payments%ROWTYPE; d public.booking_security_deposits%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; dispatched boolean:=false;
BEGIN
 PERFORM 1 FROM public.bookings b JOIN public.booking_payments p ON p.booking_id=b.id WHERE p.id=_payment_id FOR UPDATE OF b;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO a FROM public.booking_rental_agreements WHERE id=p.agreement_id;
 IF p.provider IS DISTINCT FROM 'paypal' OR p.environment NOT IN ('sandbox','live') OR p.state IS DISTINCT FROM 'paid' OR p.capture_id IS NULL OR p.paid_at IS NULL OR (a.trip_financial_summary->>'internal_test') IS DISTINCT FROM (CASE WHEN p.environment='sandbox' THEN 'true' ELSE 'false' END) THEN RAISE EXCEPTION 'Verified internal sandbox rental required'; END IF;
 SELECT * INTO d FROM public.booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 IF d.id IS NULL OR d.amount_cents<=0 OR d.amount_cents IS DISTINCT FROM (a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint OR d.currency<>p.currency THEN RAISE EXCEPTION 'Accepted deposit terms required'; END IF;
 IF d.operation_state='idle' AND d.status IN ('disabled','capability_verification_required') THEN
  UPDATE public.booking_security_deposits SET status='approval_required',operation_state='creating' WHERE id=d.id RETURNING * INTO d;
  dispatched:=true;
 END IF;
 RETURN jsonb_build_object('deposit',to_jsonb(d),'dispatch',dispatched);
END; $$;

CREATE OR REPLACE FUNCTION public.attach_paypal_sandbox_deposit(_deposit_id uuid,_order_id text) RETURNS void
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NULLIF(_order_id,'') IS NULL THEN RAISE EXCEPTION 'Order identity required'; END IF;
 UPDATE public.booking_security_deposits d SET provider_order_id=_order_id,operation_state='awaiting_approval'
 WHERE id=_deposit_id AND operation_state='creating' AND provider_order_id IS NULL
 AND EXISTS(SELECT 1 FROM public.booking_payments p WHERE p.id=d.rental_payment_id AND p.environment IN ('sandbox','live') AND p.provider='paypal' AND p.state='paid');
 IF NOT FOUND THEN RAISE EXCEPTION 'Deposit creation requires reconciliation'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.claim_paypal_sandbox_authorization(_deposit_id uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.booking_security_deposits d SET operation_state='authorizing'
 WHERE id=_deposit_id AND status='approval_required' AND operation_state='awaiting_approval' AND provider_order_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.booking_payments p WHERE p.id=d.rental_payment_id AND p.environment IN ('sandbox','live') AND p.provider='paypal' AND p.state='paid');
 IF NOT FOUND THEN RAISE EXCEPTION 'Authorization already claimed or rental not settled'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.record_paypal_sandbox_authorization(_deposit_id uuid,_order_id text,_authorization_id text,_amount_cents bigint,_currency text,_authorized_at timestamptz,_expires_at timestamptz) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE d public.booking_security_deposits%ROWTYPE; p public.booking_payments%ROWTYPE; b public.bookings%ROWTYPE; honor_end timestamptz;
BEGIN
 PERFORM 1 FROM public.bookings b JOIN public.booking_security_deposits d ON d.booking_id=b.id WHERE d.id=_deposit_id FOR UPDATE OF b;
 SELECT p.* INTO p FROM public.booking_payments p JOIN public.booking_security_deposits d ON d.rental_payment_id=p.id WHERE d.id=_deposit_id FOR UPDATE OF p;
 SELECT * INTO d FROM public.booking_security_deposits WHERE id=_deposit_id FOR UPDATE;
 SELECT * INTO b FROM public.bookings WHERE id=d.booking_id;
 IF p.provider IS DISTINCT FROM 'paypal' OR p.environment NOT IN ('sandbox','live') OR p.state IS DISTINCT FROM 'paid' OR p.capture_id IS NULL OR d.provider_order_id IS DISTINCT FROM _order_id OR NULLIF(_authorization_id,'') IS NULL OR d.amount_cents IS DISTINCT FROM _amount_cents OR d.currency IS DISTINCT FROM _currency OR d.captured_amount_cents<>0 THEN RAISE EXCEPTION 'Authorization integrity failure'; END IF;
 IF d.provider_authorization_id IS NOT NULL AND d.provider_authorization_id<>_authorization_id THEN RAISE EXCEPTION 'Conflicting authorization identity'; END IF;
 IF d.status IN ('voided','expired','failed','captured','partially_captured') THEN RAISE EXCEPTION 'Terminal deposit requires reconciliation'; END IF;
 IF _authorized_at IS NULL OR _authorized_at>now()+interval '5 minutes' OR _expires_at IS NULL OR _expires_at<=now() OR _expires_at<=_authorized_at THEN RAISE EXCEPTION 'Valid authorization timestamps required'; END IF;
 honor_end:=least(_authorized_at+interval '3 days',_expires_at);
 UPDATE public.booking_security_deposits SET provider_authorization_id=_authorization_id,status='authorized',operation_state='complete',authorized_at=_authorized_at,expires_at=_expires_at,honor_period_ends_at=honor_end,renew_after=honor_end-interval '1 hour' WHERE id=d.id;
 -- Initial short-trip coverage only. Longer trips remain unconfirmed until a
 -- separate verified renewal/reapproval path covers the trip and inspection.
 IF b.trip_status='pending_payment' AND honor_end>now() AND ((b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00')) AT TIME ZONE 'America/New_York') + interval '1 day' <= honor_end THEN
  PERFORM public.ensure_shared_vehicle_payment_claim(p.id);
  IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')) THEN RAISE EXCEPTION 'Vehicle blocked before confirmation'; END IF;
  UPDATE public.bookings SET trip_status='confirmed' WHERE id=b.id;
 END IF;
 RETURN public.get_provider_rental_payment_receipt(b.id);
END; $$;

CREATE TABLE public.paypal_booking_operations (
 kind text NOT NULL DEFAULT 'cancel' CHECK(kind IN ('cancel','release')),
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL REFERENCES booking_payments(id) ON DELETE RESTRICT UNIQUE,
 actor_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
 actor_role text NOT NULL CHECK(actor_role IN ('guest','host','admin')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 500),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','voiding','voided','refunding','reconciliation_required','complete')),
 refund_amount_cents bigint NOT NULL CHECK(refund_amount_cents>=0),
 currency text NOT NULL CHECK(currency='usd'),
 void_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
 refund_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
 provider_refund_id text UNIQUE,
 refund_status text CHECK(refund_status IN ('PENDING','COMPLETED','FAILED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
ALTER TABLE paypal_booking_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON paypal_booking_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON paypal_booking_operations TO service_role;
GRANT SELECT ON paypal_booking_operations TO authenticated;
CREATE POLICY paypal_operations_read ON paypal_booking_operations FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM booking_payments p JOIN bookings b ON b.id=p.booking_id WHERE p.id=payment_id AND (b.renter_profile_id=current_profile_id() OR b.host_profile_id=current_profile_id() OR current_profile_is_admin())));

CREATE FUNCTION public.prepare_paypal_cancellation(_payment_id uuid,_user_id uuid,_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE b bookings%ROWTYPE;p booking_payments%ROWTYPE;g profiles%ROWTYPE;o paypal_booking_operations%ROWTYPE;actor text;refund bigint;
BEGIN
 SELECT b.* INTO b FROM bookings b JOIN booking_payments p ON p.booking_id=b.id WHERE p.id=_payment_id FOR UPDATE OF b;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO g FROM profiles WHERE user_id=_user_id;
 IF p.id IS NULL OR p.provider<>'paypal' OR g.id IS NULL THEN RAISE EXCEPTION 'Verified PayPal booking required'; END IF;
 actor:=CASE WHEN g.is_admin THEN 'admin' WHEN b.renter_profile_id=g.id THEN 'guest' WHEN b.host_profile_id=g.id THEN 'host' ELSE NULL END;
 IF actor IS NULL THEN RAISE EXCEPTION 'Booking participant required'; END IF;
 SELECT * INTO o FROM paypal_booking_operations WHERE payment_id=p.id FOR UPDATE;
 IF o.id IS NOT NULL THEN RETURN to_jsonb(o); END IF;
 IF b.trip_status NOT IN ('pending_payment','confirmed') OR p.capture_id IS NULL OR p.paid_at IS NULL OR p.state NOT IN ('paid','reconciliation_required') OR length(btrim(COALESCE(_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Paid pre-trip booking and cancellation reason required'; END IF;
 -- pending_payment + paid capture still requires a refund (deposit may have failed).
 refund:=CASE WHEN actor='guest' THEN least(p.amount_cents,b.subtotal_cents+b.taxes_cents) ELSE p.amount_cents END;
 INSERT INTO paypal_booking_operations(payment_id,actor_profile_id,actor_role,reason,refund_amount_cents,currency) VALUES(p.id,g.id,actor,btrim(_reason),refund,p.currency) RETURNING * INTO o;
 UPDATE booking_payments SET state='reconciliation_required',updated_at=now() WHERE id=p.id;
 RETURN to_jsonb(o);
END; $$;
CREATE FUNCTION public.claim_paypal_cancellation_step(_operation_id uuid,_step text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF _step='void' THEN
  UPDATE paypal_booking_operations SET state='voiding' WHERE id=_operation_id AND state='prepared';
 ELSIF _step='refund' THEN
  UPDATE paypal_booking_operations SET state='refunding' WHERE id=_operation_id AND state='voided' AND provider_refund_id IS NULL;
 ELSE RAISE EXCEPTION 'Unsupported operation'; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation already claimed; reconcile without another provider POST'; END IF;
END; $$;
CREATE FUNCTION public.record_paypal_cancellation_void(_operation_id uuid,_authorization_id text,_status text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE d booking_security_deposits%ROWTYPE;
BEGIN
 SELECT d.* INTO d FROM booking_security_deposits d JOIN paypal_booking_operations o ON o.payment_id=d.rental_payment_id WHERE o.id=_operation_id AND d.generation=1 FOR UPDATE OF d;
 IF d.id IS NULL OR d.captured_amount_cents<>0 THEN RAISE EXCEPTION 'Deposit integrity required'; END IF;
 IF d.provider_authorization_id IS NOT NULL THEN
  IF (d.provider_authorization_id IS NOT NULL AND d.provider_authorization_id IS DISTINCT FROM _authorization_id) OR _status NOT IN ('VOIDED','EXPIRED') THEN RAISE EXCEPTION 'Canonical terminal authorization required'; END IF;
  UPDATE booking_security_deposits SET provider_authorization_id=_authorization_id,status=lower(_status),operation_state='complete' WHERE id=d.id;
 ELSE
  -- No authorization POST may be outstanding when releasing an empty hold.
  IF _authorization_id IS NOT NULL OR d.operation_state NOT IN ('idle','awaiting_approval') THEN RAISE EXCEPTION 'Unknown deposit outcome requires reconciliation'; END IF;
 END IF;
 UPDATE paypal_booking_operations SET state='voided' WHERE id=_operation_id AND state IN ('prepared','voiding');
END; $$;
CREATE FUNCTION public.attach_paypal_cancellation_refund(_operation_id uuid,_refund_id text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NULLIF(_refund_id,'') IS NULL THEN RAISE EXCEPTION 'Refund identity required'; END IF;
 UPDATE paypal_booking_operations SET provider_refund_id=_refund_id WHERE id=_operation_id AND state='refunding' AND (provider_refund_id IS NULL OR provider_refund_id=_refund_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Refund identity conflict'; END IF;
END; $$;
CREATE FUNCTION public.record_paypal_cancellation_refund(_operation_id uuid,_refund_id text,_capture_id text,_amount_cents bigint,_currency text,_status text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE o paypal_booking_operations%ROWTYPE;p booking_payments%ROWTYPE;
BEGIN
 SELECT * INTO o FROM paypal_booking_operations WHERE id=_operation_id FOR UPDATE;
 SELECT * INTO p FROM booking_payments WHERE id=o.payment_id;
 IF o.id IS NULL OR o.state NOT IN ('refunding','reconciliation_required','complete') OR o.provider_refund_id IS DISTINCT FROM _refund_id OR p.capture_id IS DISTINCT FROM _capture_id OR o.refund_amount_cents IS DISTINCT FROM _amount_cents OR o.currency IS DISTINCT FROM _currency OR _status NOT IN ('PENDING','COMPLETED','FAILED','CANCELLED') THEN RAISE EXCEPTION 'Canonical refund integrity failure'; END IF;
 IF o.refund_status='COMPLETED' AND _status<>'COMPLETED' THEN RAISE EXCEPTION 'Terminal refund cannot regress'; END IF;
 UPDATE paypal_booking_operations SET refund_status=_status,state=CASE WHEN state='complete' THEN state WHEN _status IN ('FAILED','CANCELLED') THEN 'reconciliation_required' ELSE state END WHERE id=o.id;
END; $$;
CREATE FUNCTION public.complete_paypal_cancellation(_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE o paypal_booking_operations%ROWTYPE;p booking_payments%ROWTYPE;b bookings%ROWTYPE;d booking_security_deposits%ROWTYPE;
BEGIN
 SELECT b.* INTO b FROM bookings b JOIN booking_payments p ON p.booking_id=b.id JOIN paypal_booking_operations o ON o.payment_id=p.id WHERE o.id=_operation_id FOR UPDATE OF b;
 SELECT p.* INTO p FROM booking_payments p JOIN paypal_booking_operations o ON o.payment_id=p.id WHERE o.id=_operation_id FOR UPDATE OF p;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 SELECT * INTO o FROM paypal_booking_operations WHERE id=_operation_id FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Operation required'; END IF;
 IF o.state='complete' THEN RETURN jsonb_build_object('ok',true,'bookingId',b.id,'state',CASE WHEN o.kind='cancel' THEN 'cancelled' ELSE 'completed' END,'refundCents',o.refund_amount_cents,'depositReleased',true); END IF;
 IF ((o.kind='cancel' AND b.trip_status NOT IN ('pending_payment','confirmed')) OR (o.kind='release' AND b.trip_status<>'pending_inspection')) OR d.captured_amount_cents<>0 OR (d.provider_authorization_id IS NOT NULL AND d.status NOT IN ('voided','expired')) OR (d.provider_authorization_id IS NULL AND d.operation_state NOT IN ('idle','awaiting_approval')) OR (o.refund_amount_cents>0 AND o.refund_status IS DISTINCT FROM 'COMPLETED') THEN RAISE EXCEPTION 'Verified refund and released deposit required'; END IF;
 UPDATE paypal_booking_operations SET state='complete',completed_at=now() WHERE id=o.id;
 UPDATE bookings SET trip_status=CASE WHEN o.kind='cancel' THEN 'cancelled' ELSE 'completed' END,cancelled_at=CASE WHEN o.kind='cancel' THEN now() ELSE cancelled_at END,cancel_reason=CASE WHEN o.kind='cancel' THEN o.reason ELSE cancel_reason END,updated_at=now() WHERE id=b.id;
 UPDATE booking_payments SET state='paid',updated_at=now() WHERE id=p.id;
 IF o.kind='cancel' THEN UPDATE vehicle_payment_claims SET released_at=COALESCE(released_at,now()) WHERE payment_id=p.id; END IF;
 -- Paid capture ID/time remain immutable; cancellation is an independent record.
 RETURN jsonb_build_object('ok',true,'bookingId',b.id,'state',CASE WHEN o.kind='cancel' THEN 'cancelled' ELSE 'completed' END,'refundCents',o.refund_amount_cents,'depositReleased',true);
END; $$;

CREATE FUNCTION public.refresh_paypal_deposit_coverage(_deposit_id uuid,_authorization_id text,_provider_status text,_expires_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE d booking_security_deposits%ROWTYPE;
BEGIN
 SELECT * INTO d FROM booking_security_deposits WHERE id=_deposit_id FOR UPDATE;
 IF d.id IS NULL OR d.provider_authorization_id IS DISTINCT FROM _authorization_id OR d.expires_at IS DISTINCT FROM _expires_at OR d.captured_amount_cents<>0 THEN RAISE EXCEPTION 'Canonical authorization identity required'; END IF;
 IF d.status IN ('voided','expired') AND _provider_status='CREATED' THEN RAISE EXCEPTION 'Terminal authorization cannot regress'; END IF;
 IF _provider_status IN ('VOIDED','EXPIRED') THEN
  UPDATE booking_security_deposits SET status=lower(_provider_status),operation_state='complete' WHERE id=d.id;
 ELSIF _provider_status='CREATED' AND d.honor_period_ends_at<=now() THEN
  UPDATE booking_security_deposits SET status='renewal_required' WHERE id=d.id;
 ELSIF _provider_status<>'CREATED' THEN RAISE EXCEPTION 'Unexpected authorization state requires review'; END IF;
 RETURN get_provider_rental_payment_receipt(d.booking_id);
END; $$;

CREATE OR REPLACE FUNCTION public.protect_provider_payment_booking() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
DECLARE p public.booking_payments%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.booking_payments WHERE booking_id=OLD.id AND provider='paypal';
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id OR NEW.stripe_payment_method_id IS DISTINCT FROM OLD.stripe_payment_method_id OR NEW.authorization_hold_payment_intent_id IS DISTINCT FROM OLD.authorization_hold_payment_intent_id THEN RAISE EXCEPTION 'PayPal payment cannot use Stripe identifiers'; END IF;
 IF ROW(NEW.subtotal_cents,NEW.service_fee_cents,NEW.taxes_cents,NEW.grand_total_cents,NEW.currency,NEW.vehicle_id,NEW.start_date,NEW.end_date,NEW.pickup_time,NEW.dropoff_time,NEW.renter_profile_id,NEW.host_profile_id,NEW.pickup_location,NEW.dropoff_location,NEW.fulfillment_method) IS DISTINCT FROM ROW(OLD.subtotal_cents,OLD.service_fee_cents,OLD.taxes_cents,OLD.grand_total_cents,OLD.currency,OLD.vehicle_id,OLD.start_date,OLD.end_date,OLD.pickup_time,OLD.dropoff_time,OLD.renter_profile_id,OLD.host_profile_id,OLD.pickup_location,OLD.dropoff_location,OLD.fulfillment_method) THEN RAISE EXCEPTION 'PayPal reservation financial and schedule terms are locked'; END IF;
 IF NEW.trip_status IS DISTINCT FROM OLD.trip_status THEN
  IF NEW.trip_status='cancelled' AND OLD.trip_status IN ('pending_payment','confirmed') AND current_setting('role',true)='service_role' AND EXISTS(SELECT 1 FROM paypal_booking_operations o WHERE o.payment_id=p.id AND o.kind='cancel' AND o.state='complete' AND (o.refund_amount_cents=0 OR o.refund_status='COMPLETED')) THEN RETURN NEW; END IF;
  IF OLD.trip_status='pending_inspection' AND NEW.trip_status='completed' AND current_setting('role',true)='service_role' AND EXISTS(SELECT 1 FROM paypal_booking_operations o WHERE o.payment_id=p.id AND o.kind='release' AND o.state='complete') AND NOT EXISTS(SELECT 1 FROM after_trip_charges c WHERE c.booking_id=OLD.id AND c.status NOT IN ('waived','voided')) THEN RETURN NEW; END IF;
  IF (public.current_profile_is_admin() OR OLD.host_profile_id=public.current_profile_id()) AND p.state='paid' AND (
   (OLD.trip_status='confirmed' AND NEW.trip_status='active' AND now()>=((OLD.start_date::timestamp+COALESCE(OLD.pickup_time,time '00:00')) AT TIME ZONE 'America/New_York') AND EXISTS(SELECT 1 FROM booking_security_deposits d WHERE d.rental_payment_id=p.id AND d.status='authorized' AND d.operation_state='complete' AND d.captured_amount_cents=0 AND d.honor_period_ends_at>=public.paypal_trip_inspection_deadline(OLD.id) AND d.honor_period_ends_at>now()))
   OR (OLD.trip_status='active' AND NEW.trip_status='pending_inspection')
  ) THEN RETURN NEW; END IF;

  IF OLD.trip_status='pending_payment' AND NEW.trip_status='confirmed' AND current_setting('role',true)='service_role' AND p.environment IN ('sandbox','live') AND p.state='paid'
   AND EXISTS(SELECT 1 FROM public.booking_rental_agreements a WHERE a.id=p.agreement_id AND a.trip_financial_summary->>'internal_test'=CASE WHEN p.environment='sandbox' THEN 'true' ELSE 'false' END)
   AND EXISTS(SELECT 1 FROM public.booking_security_deposits d WHERE d.rental_payment_id=p.id AND d.status='authorized' AND d.operation_state='complete' AND d.provider_authorization_id IS NOT NULL AND d.captured_amount_cents=0 AND d.honor_period_ends_at>now() AND ((NEW.end_date::timestamp+COALESCE(NEW.dropoff_time,time '00:00')) AT TIME ZONE 'America/New_York')+interval '1 day'<=d.honor_period_ends_at) THEN RETURN NEW; END IF;
  IF NEW.trip_status IN ('confirmed','active','pending_inspection','completed') OR p.state IN ('capturing','paid','reconciliation_required') THEN RAISE EXCEPTION 'PayPal booking requires verified deposit lifecycle or payment reconciliation'; END IF;
  UPDATE public.booking_payments SET state='cancelled',updated_at=now() WHERE id=p.id AND state IN ('creating','awaiting_approval');
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.get_provider_rental_payment_receipt(_booking_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('provider',p.provider,'state',p.state,'amountCents',p.amount_cents,'capturedAmountCents',CASE WHEN p.paid_at IS NOT NULL THEN p.amount_cents ELSE 0 END,'currency',p.currency,'depositStatus',COALESCE(d.status,'not_started'),'depositAmountCents',d.amount_cents,'depositCapturedAmountCents',d.captured_amount_cents,'tripStatus',b.trip_status,'refundedAmountCents',COALESCE((SELECT o.refund_amount_cents FROM paypal_booking_operations o WHERE o.payment_id=p.id AND o.refund_status='COMPLETED'),0),'refundStatus',(SELECT o.refund_status FROM paypal_booking_operations o WHERE o.payment_id=p.id),'reconciliationRequired',p.state='reconciliation_required','bookingConfirmed',b.trip_status='confirmed' AND p.state='paid' AND d.status='authorized' AND d.honor_period_ends_at>now() AND d.operation_state='complete' AND d.captured_amount_cents=0 AND d.honor_period_ends_at>=((b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00')) AT TIME ZONE 'America/New_York')+interval '1 day' AND NOT EXISTS(SELECT 1 FROM paypal_booking_operations o WHERE o.payment_id=p.id))
 FROM public.booking_payments p JOIN public.bookings b ON b.id=p.booking_id LEFT JOIN public.booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1 WHERE p.booking_id=_booking_id AND p.provider='paypal';
$$;

REVOKE ALL ON FUNCTION public.prepare_paypal_cancellation(uuid,uuid,text),public.claim_paypal_cancellation_step(uuid,text),public.record_paypal_cancellation_void(uuid,text,text),public.attach_paypal_cancellation_refund(uuid,text),public.record_paypal_cancellation_refund(uuid,text,text,bigint,text,text),public.complete_paypal_cancellation(uuid),public.refresh_paypal_deposit_coverage(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_paypal_cancellation(uuid,uuid,text),public.claim_paypal_cancellation_step(uuid,text),public.record_paypal_cancellation_void(uuid,text,text),public.attach_paypal_cancellation_refund(uuid,text),public.record_paypal_cancellation_refund(uuid,text,text,bigint,text,text),public.complete_paypal_cancellation(uuid),public.refresh_paypal_deposit_coverage(uuid,text,text,timestamptz) TO service_role;

CREATE FUNCTION public.prepare_paypal_deposit_return_release(_payment_id uuid,_user_id uuid,_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE b bookings%ROWTYPE;p booking_payments%ROWTYPE;g profiles%ROWTYPE;o paypal_booking_operations%ROWTYPE;
BEGIN
 SELECT b.* INTO b FROM bookings b JOIN booking_payments p ON p.booking_id=b.id WHERE p.id=_payment_id FOR UPDATE OF b;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO g FROM profiles WHERE user_id=_user_id;
 IF p.id IS NULL OR p.provider<>'paypal' OR g.id IS NULL OR NOT (g.is_admin OR g.id=b.host_profile_id) THEN RAISE EXCEPTION 'Booking operator required'; END IF;
 SELECT * INTO o FROM paypal_booking_operations WHERE payment_id=p.id FOR UPDATE;
 IF o.id IS NOT NULL THEN
  IF o.kind<>'release' THEN RAISE EXCEPTION 'Conflicting existing operation'; END IF;
  RETURN to_jsonb(o);
 END IF;
 IF b.trip_status<>'pending_inspection' OR p.state<>'paid' OR p.paid_at IS NULL OR length(btrim(COALESCE(_reason,''))) NOT BETWEEN 5 AND 500 OR EXISTS(SELECT 1 FROM after_trip_charges c WHERE c.booking_id=b.id AND c.status NOT IN ('waived','voided')) THEN RAISE EXCEPTION 'Returned trip, completed inspection and no unresolved charges required'; END IF;
 INSERT INTO paypal_booking_operations(kind,payment_id,actor_profile_id,actor_role,reason,refund_amount_cents,currency) VALUES('release',p.id,g.id,CASE WHEN g.is_admin THEN 'admin' ELSE 'host' END,btrim(_reason),0,p.currency) RETURNING * INTO o;
 UPDATE booking_payments SET state='reconciliation_required',updated_at=now() WHERE id=p.id;
 RETURN to_jsonb(o);
END; $$;
REVOKE ALL ON FUNCTION prepare_paypal_deposit_return_release(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION prepare_paypal_deposit_return_release(uuid,uuid,text) TO service_role;
ALTER TABLE vehicle_payment_claims ADD COLUMN released_at timestamptz;
GRANT UPDATE(released_at) ON vehicle_payment_claims TO service_role;

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
  AND NOT (x.trip_status='cancelled' AND EXISTS(SELECT 1 FROM booking_payments cp JOIN paypal_booking_operations o ON o.payment_id=cp.id JOIN vehicle_payment_claims vc ON vc.payment_id=cp.id WHERE cp.booking_id=x.id AND o.kind='cancel' AND o.state='complete' AND vc.released_at IS NOT NULL))
  AND (x.trip_status IN ('confirmed','active','pending_inspection','completed') OR x.stripe_checkout_session_id IS NOT NULL OR x.authorization_hold_payment_intent_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.booking_payments xp WHERE xp.booking_id=x.id))) THEN RAISE EXCEPTION 'Shared vehicle payment reservation conflicts'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && span) THEN RAISE EXCEPTION 'Vehicle blocked'; END IF;
 INSERT INTO public.vehicle_payment_claims(payment_id,booking_id,vehicle_id,reserved_span) VALUES(p.id,b.id,b.vehicle_id,span);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_paypal_rental_capture(_payment_id uuid,_user_id uuid)
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
  IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id AND NOT (x.trip_status='cancelled' AND EXISTS(SELECT 1 FROM booking_payments cp JOIN paypal_booking_operations o ON o.payment_id=cp.id WHERE cp.booking_id=x.id AND o.kind='cancel' AND o.state='complete')) AND (x.trip_status IN ('confirmed','active','pending_inspection','completed') OR EXISTS(SELECT 1 FROM public.booking_payments xp WHERE xp.booking_id=x.id AND xp.provider='paypal' AND xp.state IN ('capturing','paid','reconciliation_required'))) AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)') && tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')) THEN RAISE EXCEPTION 'Booking availability changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')) THEN RAISE EXCEPTION 'Vehicle blocked'; END IF;
  UPDATE public.booking_payments SET state='capturing',capture_started_at=now(),updated_at=now() WHERE id=p.id;
END; $$;

-- Server preflight is checked before rental create and again before capture.
CREATE FUNCTION public.paypal_card_checkout_preflight(_booking_id uuid) RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE deadline timestamptz;hold bigint;
BEGIN
 deadline:=paypal_trip_inspection_deadline(_booking_id);
 SELECT (a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint INTO hold FROM booking_rental_agreements a JOIN booking_payments p ON p.agreement_id=a.id WHERE p.booking_id=_booking_id;
 IF hold IS NULL THEN SELECT (trip_financial_summary->>'authorization_hold_amount_cents')::bigint INTO hold FROM booking_rental_agreements WHERE booking_id=_booking_id AND accepted_at IS NOT NULL LIMIT 1; END IF;
 IF deadline IS NULL OR deadline<=now() OR deadline>now()+interval '71 hours' OR COALESCE(hold,0)<=0 THEN RAISE EXCEPTION 'Trip requires unsupported deposit coverage; no rental payment should be sent'; END IF;
 RETURN deadline;
END; $$;
REVOKE ALL ON FUNCTION paypal_card_checkout_preflight(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION paypal_card_checkout_preflight(uuid) TO service_role;
ALTER POLICY rental_payment_read ON booking_payments USING(EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_id AND (b.renter_profile_id=current_profile_id() OR b.host_profile_id=current_profile_id() OR current_profile_is_admin())));
ALTER POLICY deposit_payment_read ON booking_security_deposits USING(EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_id AND (b.renter_profile_id=current_profile_id() OR b.host_profile_id=current_profile_id() OR current_profile_is_admin())));
