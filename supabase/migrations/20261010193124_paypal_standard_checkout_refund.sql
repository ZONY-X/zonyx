-- Incomplete checkout refunds the entire rental, including service fee.
-- Confirmed-trip cancellation policy is unchanged. Existing RPC grants persist.
CREATE OR REPLACE FUNCTION public.prepare_paypal_cancellation(_payment_id uuid,_user_id uuid,_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
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
 refund:=CASE WHEN actor='guest' AND b.trip_status='confirmed' THEN least(p.amount_cents,b.subtotal_cents+b.taxes_cents) ELSE p.amount_cents END;
 INSERT INTO paypal_booking_operations(payment_id,actor_profile_id,actor_role,reason,refund_amount_cents,currency) VALUES(p.id,g.id,actor,btrim(_reason),refund,p.currency) RETURNING * INTO o;
 UPDATE booking_payments SET state='reconciliation_required',updated_at=now() WHERE id=p.id;
 RETURN to_jsonb(o);
END; $$;
CREATE OR REPLACE FUNCTION public.record_paypal_cancellation_void(_operation_id uuid,_authorization_id text,_status text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
#variable_conflict use_column
DECLARE d booking_security_deposits%ROWTYPE;
BEGIN
 SELECT d.* INTO d FROM booking_security_deposits d JOIN paypal_booking_operations o ON o.payment_id=d.rental_payment_id WHERE o.id=_operation_id AND d.generation=1 FOR UPDATE OF d;
 IF d.id IS NULL OR d.captured_amount_cents<>0 THEN RAISE EXCEPTION 'Deposit integrity required'; END IF;
 IF _authorization_id IS NOT NULL THEN
  IF (d.provider_authorization_id IS NOT NULL AND d.provider_authorization_id IS DISTINCT FROM _authorization_id) OR _status NOT IN ('VOIDED','EXPIRED') THEN RAISE EXCEPTION 'Canonical terminal authorization required'; END IF;
  UPDATE booking_security_deposits SET provider_authorization_id=_authorization_id,status=lower(_status),operation_state='complete' WHERE id=d.id;
 ELSE
  -- No authorization POST may be outstanding when releasing an empty hold.
  IF d.provider_authorization_id IS NOT NULL OR d.operation_state NOT IN ('idle','awaiting_approval') THEN RAISE EXCEPTION 'Unknown deposit outcome requires reconciliation'; END IF;
 END IF;
 UPDATE paypal_booking_operations SET state='voided' WHERE id=_operation_id AND state IN ('prepared','voiding');
END; $$;
CREATE OR REPLACE FUNCTION public.claim_paypal_sandbox_authorization(_deposit_id uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 -- Same booking/payment/deposit lock order as cancellation: a cancellation
 -- freezes the rental before any further authorization can be dispatched.
 PERFORM 1 FROM public.bookings b JOIN public.booking_security_deposits d ON d.booking_id=b.id WHERE d.id=_deposit_id FOR UPDATE OF b;
 PERFORM 1 FROM public.booking_payments p JOIN public.booking_security_deposits d ON d.rental_payment_id=p.id WHERE d.id=_deposit_id FOR UPDATE OF p;
 UPDATE public.booking_security_deposits d SET operation_state='authorizing'
 WHERE id=_deposit_id AND status='approval_required' AND operation_state='awaiting_approval' AND provider_order_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.booking_payments p WHERE p.id=d.rental_payment_id AND p.environment IN ('sandbox','live') AND p.provider='paypal' AND p.state='paid');
 IF NOT FOUND THEN RAISE EXCEPTION 'Authorization already claimed or rental not settled'; END IF;
END; $$;
