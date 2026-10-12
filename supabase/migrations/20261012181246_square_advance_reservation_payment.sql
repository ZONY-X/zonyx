-- Rental payment and deposit authorization have separate timing requirements.
-- Preserve all ownership, agreement, provider and inventory protections.
CREATE OR REPLACE FUNCTION public.prepare_square_live_checkout(_booking_id uuid,_agreement_id uuid,_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE p booking_payments%ROWTYPE; d booking_security_deposits%ROWTYPE; a booking_rental_agreements%ROWTYPE; existed boolean;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM 1 FROM bookings WHERE id=_booking_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM booking_payments WHERE booking_id=_booking_id) INTO existed;
 SELECT * INTO a FROM booking_rental_agreements WHERE id=_agreement_id AND booking_id=_booking_id;
 IF a.document_hash IS NULL OR (a.trip_financial_summary->>'internal_test') IS DISTINCT FROM 'false' OR a.guest_auth_user_id IS DISTINCT FROM _user_id THEN RAISE EXCEPTION 'Accepted customer Square terms required'; END IF;
 IF paypal_trip_inspection_deadline(_booking_id)<=now() THEN RAISE EXCEPTION 'Reservation inspection window has ended'; END IF;
 IF COALESCE((a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint,0)<=0 THEN RAISE EXCEPTION 'Accepted deposit required'; END IF;
 p:=reserve_rental_payment_provider(_booking_id,_agreement_id,'square',_user_id,'live');
 IF existed THEN RETURN jsonb_build_object('payment',to_jsonb(p),'dispatch',false); END IF;
 INSERT INTO booking_security_deposits(booking_id,rental_payment_id,provider,amount_cents,status,operation_state)
 VALUES(p.booking_id,p.id,'square',(a.trip_financial_summary->>'authorization_hold_amount_cents')::bigint,'approval_required','idle') RETURNING * INTO d;
 INSERT INTO square_payment_operations(payment_id,rental_started,checkout_sequence) VALUES(p.id,true,'rental_then_hold');
 UPDATE booking_payments SET state='capturing',capture_started_at=now() WHERE id=p.id RETURNING * INTO p;
 RETURN jsonb_build_object('payment',to_jsonb(p),'deposit',to_jsonb(d),'dispatch',true);
END; $$;
