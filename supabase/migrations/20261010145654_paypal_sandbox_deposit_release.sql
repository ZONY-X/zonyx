-- Release is a separate authorization void, never a deposit capture.
CREATE FUNCTION public.claim_paypal_sandbox_deposit_release(_deposit_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE booking_security_deposits d SET operation_state='reconciliation_required'
 WHERE d.id=_deposit_id AND d.status='authorized' AND d.operation_state='complete' AND d.provider_authorization_id IS NOT NULL AND d.captured_amount_cents=0
 AND EXISTS(SELECT 1 FROM booking_payments p WHERE p.id=d.rental_payment_id AND p.provider='paypal' AND p.environment='sandbox' AND p.state='paid');
 IF NOT FOUND THEN RAISE EXCEPTION 'Release already claimed or authorization unavailable'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.claim_paypal_sandbox_deposit_release(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paypal_sandbox_deposit_release(uuid) TO service_role;
