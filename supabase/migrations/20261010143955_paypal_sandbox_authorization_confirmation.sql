-- Additive sandbox-only authorization lifecycle. Never captures a deposit.
ALTER TABLE public.booking_security_deposits ADD COLUMN operation_state text NOT NULL DEFAULT 'idle'
 CHECK(operation_state IN ('idle','creating','awaiting_approval','authorizing','reconciliation_required','complete'));
ALTER TABLE public.booking_security_deposits ADD COLUMN create_request_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.booking_security_deposits ADD COLUMN authorize_request_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX deposit_provider_order_identity ON public.booking_security_deposits(provider,provider_order_id) WHERE provider_order_id IS NOT NULL;

CREATE FUNCTION public.prepare_paypal_sandbox_deposit(_payment_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE p public.booking_payments%ROWTYPE; d public.booking_security_deposits%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; dispatched boolean:=false;
BEGIN
 PERFORM 1 FROM public.bookings b JOIN public.booking_payments p ON p.booking_id=b.id WHERE p.id=_payment_id FOR UPDATE OF b;
 SELECT * INTO p FROM public.booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO a FROM public.booking_rental_agreements WHERE id=p.agreement_id;
 IF p.provider IS DISTINCT FROM 'paypal' OR p.environment IS DISTINCT FROM 'sandbox' OR p.state IS DISTINCT FROM 'paid' OR p.capture_id IS NULL OR p.paid_at IS NULL OR a.trip_financial_summary->>'internal_test' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Verified internal sandbox rental required'; END IF;
 SELECT * INTO d FROM public.booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 IF d.id IS NULL OR d.amount_cents<=0 OR d.amount_cents IS DISTINCT FROM (a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint OR d.currency<>p.currency THEN RAISE EXCEPTION 'Accepted deposit terms required'; END IF;
 IF d.operation_state='idle' AND d.status IN ('disabled','capability_verification_required') THEN
  UPDATE public.booking_security_deposits SET status='approval_required',operation_state='creating' WHERE id=d.id RETURNING * INTO d;
  dispatched:=true;
 END IF;
 RETURN jsonb_build_object('deposit',to_jsonb(d),'dispatch',dispatched);
END; $$;
CREATE FUNCTION public.attach_paypal_sandbox_deposit(_deposit_id uuid,_order_id text) RETURNS void
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NULLIF(_order_id,'') IS NULL THEN RAISE EXCEPTION 'Order identity required'; END IF;
 UPDATE public.booking_security_deposits d SET provider_order_id=_order_id,operation_state='awaiting_approval'
 WHERE id=_deposit_id AND operation_state='creating' AND provider_order_id IS NULL
 AND EXISTS(SELECT 1 FROM public.booking_payments p WHERE p.id=d.rental_payment_id AND p.environment='sandbox' AND p.provider='paypal' AND p.state='paid');
 IF NOT FOUND THEN RAISE EXCEPTION 'Deposit creation requires reconciliation'; END IF;
END; $$;
CREATE FUNCTION public.claim_paypal_sandbox_authorization(_deposit_id uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.booking_security_deposits d SET operation_state='authorizing'
 WHERE id=_deposit_id AND status='approval_required' AND operation_state='awaiting_approval' AND provider_order_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.booking_payments p WHERE p.id=d.rental_payment_id AND p.environment='sandbox' AND p.provider='paypal' AND p.state='paid');
 IF NOT FOUND THEN RAISE EXCEPTION 'Authorization already claimed or rental not settled'; END IF;
END; $$;
CREATE FUNCTION public.record_paypal_sandbox_authorization(_deposit_id uuid,_order_id text,_authorization_id text,_amount_cents bigint,_currency text,_authorized_at timestamptz,_expires_at timestamptz) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE d public.booking_security_deposits%ROWTYPE; p public.booking_payments%ROWTYPE; b public.bookings%ROWTYPE; honor_end timestamptz;
BEGIN
 PERFORM 1 FROM public.bookings b JOIN public.booking_security_deposits d ON d.booking_id=b.id WHERE d.id=_deposit_id FOR UPDATE OF b;
 SELECT p.* INTO p FROM public.booking_payments p JOIN public.booking_security_deposits d ON d.rental_payment_id=p.id WHERE d.id=_deposit_id FOR UPDATE OF p;
 SELECT * INTO d FROM public.booking_security_deposits WHERE id=_deposit_id FOR UPDATE;
 SELECT * INTO b FROM public.bookings WHERE id=d.booking_id;
 IF p.provider IS DISTINCT FROM 'paypal' OR p.environment IS DISTINCT FROM 'sandbox' OR p.state IS DISTINCT FROM 'paid' OR p.capture_id IS NULL OR d.provider_order_id IS DISTINCT FROM _order_id OR NULLIF(_authorization_id,'') IS NULL OR d.amount_cents IS DISTINCT FROM _amount_cents OR d.currency IS DISTINCT FROM _currency OR d.captured_amount_cents<>0 THEN RAISE EXCEPTION 'Authorization integrity failure'; END IF;
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

-- Preserve all existing financial/identifier locks; allow only a verified,
-- short-trip sandbox authorization to unlock the first confirmation transition.
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
  IF OLD.trip_status='pending_payment' AND NEW.trip_status='confirmed' AND current_setting('role',true)='service_role' AND p.environment='sandbox' AND p.state='paid'
   AND EXISTS(SELECT 1 FROM public.booking_rental_agreements a WHERE a.id=p.agreement_id AND a.trip_financial_summary->>'internal_test'='true')
   AND EXISTS(SELECT 1 FROM public.booking_security_deposits d WHERE d.rental_payment_id=p.id AND d.status='authorized' AND d.operation_state='complete' AND d.provider_authorization_id IS NOT NULL AND d.captured_amount_cents=0 AND d.honor_period_ends_at>now() AND ((NEW.end_date::timestamp+COALESCE(NEW.dropoff_time,time '00:00')) AT TIME ZONE 'America/New_York')+interval '1 day'<=d.honor_period_ends_at) THEN RETURN NEW; END IF;
  IF NEW.trip_status IN ('confirmed','active','pending_inspection','completed') OR p.state IN ('capturing','paid','reconciliation_required') THEN RAISE EXCEPTION 'PayPal booking requires verified deposit lifecycle or payment reconciliation'; END IF;
  UPDATE public.booking_payments SET state='cancelled',updated_at=now() WHERE id=p.id AND state IN ('creating','awaiting_approval');
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.get_provider_rental_payment_receipt(_booking_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('provider',p.provider,'state',p.state,'amountCents',p.amount_cents,'capturedAmountCents',CASE WHEN p.paid_at IS NOT NULL THEN p.amount_cents ELSE 0 END,'currency',p.currency,'depositStatus',COALESCE(d.status,'not_started'),'depositAmountCents',d.amount_cents,'depositCapturedAmountCents',d.captured_amount_cents,'reconciliationRequired',p.state='reconciliation_required','bookingConfirmed',b.trip_status='confirmed' AND p.state='paid' AND d.status='authorized' AND d.honor_period_ends_at>now())
 FROM public.booking_payments p JOIN public.bookings b ON b.id=p.booking_id LEFT JOIN public.booking_security_deposits d ON d.rental_payment_id=p.id AND d.generation=1 WHERE p.booking_id=_booking_id AND p.provider='paypal';
$$;
REVOKE ALL ON FUNCTION public.prepare_paypal_sandbox_deposit(uuid),public.attach_paypal_sandbox_deposit(uuid,text),public.claim_paypal_sandbox_authorization(uuid),public.record_paypal_sandbox_authorization(uuid,text,text,bigint,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_paypal_sandbox_deposit(uuid),public.attach_paypal_sandbox_deposit(uuid,text),public.claim_paypal_sandbox_authorization(uuid),public.record_paypal_sandbox_authorization(uuid,text,text,bigint,text,timestamptz,timestamptz) TO service_role;

CREATE FUNCTION public.record_paypal_sandbox_deposit_void(_deposit_id uuid,_order_id text,_authorization_id text) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE d public.booking_security_deposits%ROWTYPE; p public.booking_payments%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.bookings b JOIN public.booking_security_deposits d ON d.booking_id=b.id WHERE d.id=_deposit_id FOR UPDATE OF b;
 SELECT p.* INTO p FROM public.booking_payments p JOIN public.booking_security_deposits d ON d.rental_payment_id=p.id WHERE d.id=_deposit_id FOR UPDATE OF p;
 SELECT * INTO d FROM public.booking_security_deposits WHERE id=_deposit_id FOR UPDATE;
 IF p.environment IS DISTINCT FROM 'sandbox' OR p.provider IS DISTINCT FROM 'paypal' OR d.provider_order_id IS DISTINCT FROM _order_id OR d.provider_authorization_id IS DISTINCT FROM _authorization_id OR NULLIF(_authorization_id,'') IS NULL OR d.captured_amount_cents<>0 THEN RAISE EXCEPTION 'Void evidence integrity failure'; END IF;
 UPDATE public.booking_security_deposits SET status='voided',operation_state='complete' WHERE id=d.id;
 UPDATE public.booking_payments SET state='reconciliation_required',updated_at=now() WHERE id=p.id;
END; $$;
REVOKE ALL ON FUNCTION public.record_paypal_sandbox_deposit_void(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_paypal_sandbox_deposit_void(uuid,text,text) TO service_role;
