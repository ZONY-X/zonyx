-- Additive, unapplied: existing wallet/Stripe rows and financial RPCs survive.
ALTER TABLE public.booking_payments ADD COLUMN checkout_method text NOT NULL DEFAULT 'paypal_wallet'
  CHECK (checkout_method IN ('card','paypal_wallet'));

CREATE FUNCTION public.prepare_paypal_expanded_payment(_booking_id uuid,_agreement_id uuid,_user_id uuid,_environment text,_method text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result jsonb; p public.booking_payments%ROWTYPE;
BEGIN
  IF _method NOT IN ('card','paypal_wallet') OR _method IS NULL THEN RAISE EXCEPTION 'Unsupported payment method'; END IF;
  -- Original preparation locks the booking, validates agreement/amounts, and
  -- permits only one durable dispatch. Method choice is in that transaction.
  result:=public.prepare_paypal_rental_payment(_booking_id,_agreement_id,_user_id,_environment);
  SELECT * INTO p FROM public.booking_payments WHERE id=(result->'payment'->>'id')::uuid FOR UPDATE;
  IF (result->>'dispatch')::boolean THEN
    UPDATE public.booking_payments SET checkout_method=_method WHERE id=p.id RETURNING * INTO p;
  ELSIF p.checkout_method<>_method THEN
    RAISE EXCEPTION 'Existing payment method is locked; reconcile original payment';
  END IF;
  RETURN jsonb_build_object('payment',to_jsonb(p),'dispatch',(result->>'dispatch')::boolean);
END; $$;

CREATE OR REPLACE FUNCTION public.attach_paypal_rental_order(_payment_id uuid,_order_id text,_approval_url text)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF _order_id IS NULL OR length(_order_id)=0 THEN RAISE EXCEPTION 'Order identity required'; END IF;
  UPDATE public.booking_payments SET order_id=_order_id,approval_url=_approval_url,state='awaiting_approval',updated_at=now()
    WHERE id=_payment_id AND provider='paypal' AND state='creating' AND order_id IS NULL
      AND ((checkout_method='card' AND _approval_url IS NULL) OR (checkout_method='paypal_wallet' AND _approval_url IS NOT NULL));
  IF NOT FOUND THEN RAISE EXCEPTION 'Order claim is no longer eligible'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.prepare_paypal_expanded_payment(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_paypal_expanded_payment(uuid,uuid,uuid,text,text) TO service_role;
