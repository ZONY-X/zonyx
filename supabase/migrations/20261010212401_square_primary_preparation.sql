-- Preparation only: no deployment, backfill or enablement. Square is sandbox-only.
-- Preserve existing provider ownership. New Stripe customer checkout is retired in Edge/UI.
CREATE OR REPLACE FUNCTION public.reserve_rental_payment_provider(_booking_id uuid,_agreement_id uuid,_provider text,_user_id uuid,_environment text)
RETURNS public.booking_payments LANGUAGE plpgsql SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; p public.booking_payments%ROWTYPE; s jsonb;
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF _provider='square' AND _environment<>'sandbox' THEN RAISE EXCEPTION 'Square live is unavailable in preparation'; END IF;
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
CREATE TABLE public.square_payment_operations (
 payment_id uuid PRIMARY KEY REFERENCES public.booking_payments(id),
 hold_started boolean NOT NULL DEFAULT false,
 rental_started boolean NOT NULL DEFAULT false,
 cancel_requested boolean NOT NULL DEFAULT false,
 void_started boolean NOT NULL DEFAULT false,
 refund_started boolean NOT NULL DEFAULT false,
 refund_key uuid NOT NULL DEFAULT gen_random_uuid(),
 refund_id text UNIQUE,
 refund_amount_cents bigint,
 refund_status text,
 reason text
);
ALTER TABLE public.square_payment_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_payment_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.square_payment_operations TO service_role;

CREATE FUNCTION public.prepare_square_payment(_booking_id uuid,_agreement_id uuid,_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; a booking_rental_agreements%ROWTYPE; existed boolean;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings WHERE id=_booking_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM booking_payments WHERE booking_id=_booking_id) INTO existed;
 SELECT * INTO a FROM booking_rental_agreements WHERE id=_agreement_id;
 IF a.document_hash IS NULL OR (a.trip_financial_summary->>'internal_test') IS DISTINCT FROM 'true' OR
 NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=_user_id AND (is_internal_tester OR is_admin)) THEN RAISE EXCEPTION 'Square internal sandbox terms required'; END IF;
 IF paypal_trip_inspection_deadline(_booking_id) NOT BETWEEN now() AND now()+interval '167 hours' THEN RAISE EXCEPTION 'Square deposit coverage insufficient'; END IF;
 p:=reserve_rental_payment_provider(_booking_id,_agreement_id,'square',_user_id,'sandbox');
 IF existed THEN RETURN jsonb_build_object('payment',to_jsonb(p),'dispatch',false); END IF;
 IF (a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint<=0 OR (a.trip_financial_summary->>'authorization_hold_amount_cents') IS NULL THEN RAISE EXCEPTION 'Accepted deposit required'; END IF;
 INSERT INTO booking_security_deposits(booking_id,rental_payment_id,provider,amount_cents,status,operation_state)
 VALUES(p.booking_id,p.id,'square',(a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint,'approval_required','authorizing') RETURNING * INTO d;
 INSERT INTO square_payment_operations(payment_id,hold_started) VALUES(p.id,true);
 RETURN jsonb_build_object('payment',to_jsonb(p),'deposit',to_jsonb(d),'dispatch',true);
END; $$;

CREATE FUNCTION public.claim_square_step(_payment_id uuid,_step text,_user_id uuid,_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; b bookings%ROWTYPE; o square_payment_operations%ROWTYPE; g profiles%ROWTYPE; dispatch boolean:=false;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 SELECT b0.* INTO b FROM bookings b0 JOIN booking_payments p0 ON p0.booking_id=b0.id WHERE p0.id=_payment_id FOR UPDATE OF b0;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 SELECT * INTO g FROM profiles WHERE user_id=_user_id;
 IF p.provider IS DISTINCT FROM 'square' OR p.environment IS DISTINCT FROM 'sandbox' OR g.id IS DISTINCT FROM b.renter_profile_id THEN RAISE EXCEPTION 'Square booking owner required'; END IF;
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

-- Only service-role Edge code may supply evidence, after canonical Square GET.
CREATE FUNCTION public.record_square_payment(_payment_id uuid,_hold boolean,_provider_id text,_status text,_amount bigint,_expires timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; o square_payment_operations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings b JOIN booking_payments p0 ON p0.booking_id=b.id WHERE p0.id=_payment_id FOR UPDATE OF b;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 IF p.provider IS DISTINCT FROM 'square' OR p.environment IS DISTINCT FROM 'sandbox' OR NULLIF(_provider_id,'') IS NULL OR _amount IS DISTINCT FROM (CASE WHEN _hold THEN d.amount_cents ELSE p.amount_cents END) THEN RAISE EXCEPTION 'Square evidence conflicts'; END IF;
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

CREATE FUNCTION public.record_square_refund(_payment_id uuid,_id text,_rental_id text,_amount bigint,_status text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; o square_payment_operations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 IF p.provider IS DISTINCT FROM 'square' OR p.capture_id IS DISTINCT FROM _rental_id OR NOT o.refund_started OR o.refund_amount_cents IS DISTINCT FROM _amount OR NULLIF(_id,'') IS NULL OR (o.refund_id IS NOT NULL AND o.refund_id<>_id) THEN RAISE EXCEPTION 'Square refund integrity failure'; END IF;
 IF o.refund_status='COMPLETED' AND _status<>'COMPLETED' THEN RETURN; END IF;
 UPDATE square_payment_operations SET refund_id=_id,refund_status=_status WHERE payment_id=p.id;
END; $$;

CREATE FUNCTION public.guard_square_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM booking_payments WHERE booking_id=OLD.id AND provider='square') THEN
  IF ROW(NEW.subtotal_cents,NEW.service_fee_cents,NEW.taxes_cents,NEW.grand_total_cents,NEW.currency,NEW.vehicle_id,NEW.start_date,NEW.end_date,NEW.pickup_time,NEW.dropoff_time,NEW.renter_profile_id,NEW.host_profile_id,NEW.pickup_location,NEW.dropoff_location,NEW.fulfillment_method,NEW.stripe_checkout_session_id,NEW.stripe_customer_id,NEW.stripe_payment_method_id,NEW.authorization_hold_payment_intent_id) IS DISTINCT FROM ROW(OLD.subtotal_cents,OLD.service_fee_cents,OLD.taxes_cents,OLD.grand_total_cents,OLD.currency,OLD.vehicle_id,OLD.start_date,OLD.end_date,OLD.pickup_time,OLD.dropoff_time,OLD.renter_profile_id,OLD.host_profile_id,OLD.pickup_location,OLD.dropoff_location,OLD.fulfillment_method,OLD.stripe_checkout_session_id,OLD.stripe_customer_id,OLD.stripe_payment_method_id,OLD.authorization_hold_payment_intent_id) THEN RAISE EXCEPTION 'Square booking requires verified release lifecycle'; END IF;
  IF NEW.trip_status IS DISTINCT FROM OLD.trip_status THEN
   IF NEW.trip_status<>'cancelled' OR current_setting('role',true)<>'service_role' OR NOT EXISTS(SELECT 1 FROM booking_payments p JOIN booking_security_deposits d ON d.rental_payment_id=p.id JOIN square_payment_operations o ON o.payment_id=p.id WHERE p.booking_id=OLD.id AND o.cancel_requested AND d.status IN ('voided','expired','failed') AND (NOT o.rental_started OR (p.state='failed' AND p.order_id IS NOT NULL AND p.paid_at IS NULL) OR (p.paid_at IS NOT NULL AND o.refund_status='COMPLETED'))) THEN RAISE EXCEPTION 'Square booking requires verified release lifecycle'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_square_booking BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION guard_square_booking();
REVOKE ALL ON FUNCTION public.guard_square_booking() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prepare_square_payment(uuid,uuid,uuid),public.claim_square_step(uuid,text,uuid,text),public.record_square_payment(uuid,boolean,text,text,bigint,timestamptz),public.record_square_refund(uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_square_payment(uuid,uuid,uuid),public.claim_square_step(uuid,text,uuid,text),public.record_square_payment(uuid,boolean,text,text,bigint,timestamptz),public.record_square_refund(uuid,text,text,bigint,text) TO service_role;

-- Add Square receipts while preserving the complete PayPal receipt implementation.
ALTER FUNCTION public.get_provider_rental_payment_receipt(uuid) RENAME TO get_paypal_rental_payment_receipt;
GRANT SELECT(payment_id,refund_amount_cents,refund_status,cancel_requested) ON square_payment_operations TO authenticated;
CREATE POLICY square_operation_owner_read ON square_payment_operations FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM booking_payments p WHERE p.id=payment_id));
CREATE FUNCTION public.get_provider_rental_payment_receipt(_booking_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT COALESCE((SELECT jsonb_build_object('provider',p.provider,'state',p.state,'amountCents',p.amount_cents,
 'capturedAmountCents',CASE WHEN p.paid_at IS NULL THEN 0 ELSE p.amount_cents END,'currency',p.currency,'depositStatus',d.status,
 'depositAmountCents',d.amount_cents,'depositCapturedAmountCents',d.captured_amount_cents,'tripStatus',b.trip_status,
 'refundedAmountCents',CASE WHEN o.refund_status='COMPLETED' THEN o.refund_amount_cents ELSE 0 END,'refundStatus',o.refund_status,
 'reconciliationRequired',p.state='reconciliation_required' OR o.cancel_requested,'bookingConfirmed',false)
 FROM booking_payments p JOIN bookings b ON b.id=p.booking_id JOIN booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1
 JOIN square_payment_operations o ON o.payment_id=p.id WHERE p.booking_id=_booking_id AND p.provider='square'),get_paypal_rental_payment_receipt(_booking_id));
$$;
REVOKE ALL ON FUNCTION public.get_provider_rental_payment_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_provider_rental_payment_receipt(uuid) TO authenticated,service_role;

CREATE FUNCTION public.flag_square_reconciliation(_payment_id uuid) RETURNS void LANGUAGE sql SET search_path=public AS $$
 UPDATE booking_payments SET state='reconciliation_required',updated_at=now() WHERE id=_payment_id AND provider='square' AND state<>'cancelled';
$$;
CREATE FUNCTION public.complete_square_cancellation(_payment_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
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
 -- Shared inventory claims deliberately persist, matching existing PayPal policy.
END; $$;
REVOKE ALL ON FUNCTION public.flag_square_reconciliation(uuid),public.complete_square_cancellation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.flag_square_reconciliation(uuid),public.complete_square_cancellation(uuid) TO service_role;
