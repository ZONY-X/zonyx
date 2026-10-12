ALTER TABLE public.square_payment_operations ADD COLUMN checkout_sequence text NOT NULL DEFAULT 'hold_then_rental'
 CHECK (checkout_sequence IN ('hold_then_rental','rental_then_hold'));
ALTER TABLE public.square_payment_operations ADD COLUMN current_hold_attempt uuid;
CREATE TABLE public.square_deposit_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL REFERENCES public.booking_payments(id),
 state text NOT NULL DEFAULT 'dispatching' CHECK (state IN ('dispatching','authorized','failed','voided','reconciliation_required')),
 provider_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.square_deposit_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_deposit_attempts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.square_deposit_attempts TO service_role;
ALTER TABLE public.square_payment_operations ADD CONSTRAINT square_current_hold_attempt_fk
 FOREIGN KEY(current_hold_attempt) REFERENCES public.square_deposit_attempts(id);

CREATE FUNCTION public.prepare_square_live_checkout(_booking_id uuid,_agreement_id uuid,_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; a booking_rental_agreements%ROWTYPE; existed boolean;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings WHERE id=_booking_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM booking_payments WHERE booking_id=_booking_id) INTO existed;
 SELECT * INTO a FROM booking_rental_agreements WHERE id=_agreement_id AND booking_id=_booking_id;
 IF a.document_hash IS NULL OR (a.trip_financial_summary->>'internal_test') IS DISTINCT FROM 'false' OR a.guest_auth_user_id IS DISTINCT FROM _user_id THEN RAISE EXCEPTION 'Accepted customer Square terms required'; END IF;
 IF paypal_trip_inspection_deadline(_booking_id) NOT BETWEEN now() AND now()+interval '167 hours' THEN RAISE EXCEPTION 'Square deposit coverage insufficient'; END IF;
 IF COALESCE((a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint,0)<=0 THEN RAISE EXCEPTION 'Accepted deposit required'; END IF;
 p:=reserve_rental_payment_provider(_booking_id,_agreement_id,'square',_user_id,'live');
 IF existed THEN RETURN jsonb_build_object('payment',to_jsonb(p),'dispatch',false); END IF;
 INSERT INTO booking_security_deposits(booking_id,rental_payment_id,provider,amount_cents,status,operation_state)
 VALUES(p.booking_id,p.id,'square',(a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint,'approval_required','idle') RETURNING * INTO d;
 INSERT INTO square_payment_operations(payment_id,rental_started,checkout_sequence) VALUES(p.id,true,'rental_then_hold');
 UPDATE booking_payments SET state='capturing',capture_started_at=now() WHERE id=p.id RETURNING * INTO p;
 RETURN jsonb_build_object('payment',to_jsonb(p),'deposit',to_jsonb(d),'dispatch',true);
END; $$;

CREATE FUNCTION public.claim_square_deposit_attempt(_payment_id uuid,_user_id uuid) RETURNS jsonb
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
 IF paypal_trip_inspection_deadline(b.id) NOT BETWEEN now() AND now()+interval '167 hours' THEN RAISE EXCEPTION 'Square deposit coverage insufficient'; END IF;
 PERFORM ensure_shared_vehicle_payment_claim(p.id);
 INSERT INTO square_deposit_attempts(payment_id) VALUES(p.id) RETURNING * INTO h;
 UPDATE square_payment_operations SET hold_started=true,current_hold_attempt=h.id,void_started=false WHERE payment_id=p.id;
 UPDATE booking_security_deposits SET status='approval_required',operation_state='authorizing',provider_authorization_id=NULL,provider_order_id=NULL,expires_at=NULL,honor_period_ends_at=NULL WHERE id=d.id;
 RETURN jsonb_build_object('attempt',to_jsonb(h),'dispatch',true);
END; $$;

CREATE FUNCTION public.record_square_deposit_attempt(_payment_id uuid,_attempt_id uuid,_provider_id text,_status text,_amount bigint,_expires timestamptz DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; o square_payment_operations%ROWTYPE; d booking_security_deposits%ROWTYPE; h square_deposit_attempts%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings b JOIN booking_payments p0 ON p0.booking_id=b.id WHERE p0.id=_payment_id FOR UPDATE OF b;
 SELECT * INTO p FROM booking_payments WHERE id=_payment_id FOR UPDATE;
 SELECT * INTO o FROM square_payment_operations WHERE payment_id=p.id FOR UPDATE;
 SELECT * INTO d FROM booking_security_deposits WHERE rental_payment_id=p.id AND generation=1 FOR UPDATE;
 SELECT * INTO h FROM square_deposit_attempts WHERE id=_attempt_id AND payment_id=p.id FOR UPDATE;
 IF p.provider IS DISTINCT FROM 'square' OR p.environment IS DISTINCT FROM 'live' OR h.id IS NULL OR _amount IS DISTINCT FROM d.amount_cents
 OR (h.provider_id IS NOT NULL AND h.provider_id IS DISTINCT FROM _provider_id)
 OR (_provider_id IS NULL AND _status<>'FAILED') THEN RAISE EXCEPTION 'Square deposit attempt evidence conflicts'; END IF;
 -- A late event for a previous decline must never overwrite the active attempt.
 IF h.state IN ('failed','voided') AND _status='APPROVED' THEN RETURN; END IF;
 UPDATE square_deposit_attempts SET provider_id=COALESCE(_provider_id,provider_id),state=CASE _status WHEN 'APPROVED' THEN 'authorized' WHEN 'FAILED' THEN 'failed' WHEN 'CANCELED' THEN 'voided' ELSE 'reconciliation_required' END WHERE id=h.id;
 IF o.current_hold_attempt IS DISTINCT FROM h.id THEN RETURN; END IF;
 UPDATE booking_security_deposits SET provider_authorization_id=_provider_id,provider_order_id=_provider_id,
  status=CASE _status WHEN 'APPROVED' THEN 'authorized' WHEN 'FAILED' THEN 'failed' WHEN 'CANCELED' THEN 'voided' ELSE 'capability_verification_required' END,
  operation_state='complete',expires_at=_expires,honor_period_ends_at=_expires WHERE id=d.id;
 IF _status NOT IN ('APPROVED','FAILED','CANCELED') THEN PERFORM flag_square_reconciliation(p.id); END IF;
END; $$;

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
  IF d.status IN ('voided','expired','failed') AND (NOT o.rental_started OR (p.state='failed' AND p.order_id IS NOT NULL AND p.paid_at IS NULL) OR (p.paid_at IS NOT NULL AND o.refund_status='COMPLETED')) THEN PERFORM complete_square_cancellation(p.id); END IF;
 ELSIF b.trip_status='pending_payment' AND square_confirmation_ready(b.id) THEN
  PERFORM ensure_shared_vehicle_payment_claim(p.id); UPDATE bookings SET trip_status='confirmed' WHERE id=b.id;
 ELSIF p.paid_at IS NOT NULL AND (b.trip_status='confirmed' OR (b.trip_status='pending_payment' AND (o.checkout_sequence<>'rental_then_hold' OR d.status='authorized'))) AND NOT square_confirmation_ready(b.id) THEN
  PERFORM flag_square_reconciliation(p.id);
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.prepare_square_live_checkout(uuid,uuid,uuid),public.claim_square_deposit_attempt(uuid,uuid),public.record_square_deposit_attempt(uuid,uuid,text,text,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_square_live_checkout(uuid,uuid,uuid),public.claim_square_deposit_attempt(uuid,uuid),public.record_square_deposit_attempt(uuid,uuid,text,text,bigint,timestamptz) TO service_role;

CREATE FUNCTION public.release_square_unstarted_deposit(_payment_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings b JOIN booking_payments p ON p.booking_id=b.id WHERE p.id=_payment_id FOR UPDATE OF b;
 PERFORM 1 FROM square_payment_operations WHERE payment_id=_payment_id FOR UPDATE;
 UPDATE booking_security_deposits d SET status='failed',operation_state='complete'
 FROM square_payment_operations o JOIN booking_payments p ON p.id=o.payment_id
 WHERE d.rental_payment_id=p.id AND p.id=_payment_id AND p.provider='square' AND p.environment='live'
 AND o.checkout_sequence='rental_then_hold' AND o.cancel_requested AND NOT o.hold_started
 AND o.current_hold_attempt IS NULL AND d.provider_authorization_id IS NULL AND d.operation_state='idle';
END; $$;
REVOKE ALL ON FUNCTION public.release_square_unstarted_deposit(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_square_unstarted_deposit(uuid) TO service_role;
