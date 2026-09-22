-- Permanently delete only eligible test/invalid bookings while preserving
-- immutable financial and operational history. The function is one PostgreSQL
-- transaction: any failure rolls back all dependent cleanup.

CREATE OR REPLACE FUNCTION public.protect_booking_rental_agreement_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.admin_booking_delete', true) = 'allowed'
     AND public.current_profile_is_admin() THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Accepted Rental Agreement history is immutable.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Accepted Rental Agreement history is immutable.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Rental Agreement identity cannot change.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  booking_row public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Only admins can permanently delete bookings.';
  END IF;

  SELECT * INTO booking_row
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;

  IF booking_row.trip_status NOT IN ('pending_payment', 'payment_failed', 'cancelled') THEN
    RAISE EXCEPTION 'Only unpaid, failed-payment, or cancelled test/invalid bookings can be permanently deleted.';
  END IF;

  IF booking_row.stripe_checkout_session_id IS NOT NULL
     OR booking_row.stripe_customer_id IS NOT NULL
     OR booking_row.stripe_payment_method_id IS NOT NULL
     OR booking_row.stripe_payment_intent_id IS NOT NULL
     OR booking_row.stripe_refund_id IS NOT NULL
     OR booking_row.authorization_hold_payment_intent_id IS NOT NULL
     OR booking_row.authorization_hold_status IS NOT NULL
     OR booking_row.authorization_hold_created_at IS NOT NULL
     OR booking_row.authorization_hold_captured_at IS NOT NULL
     OR booking_row.authorization_hold_released_at IS NOT NULL
     OR COALESCE(booking_row.authorization_hold_captured_amount_cents, 0) <> 0
     OR COALESCE(booking_row.refund_amount_cents, 0) <> 0 THEN
    RAISE EXCEPTION 'This booking has payment, refund, or authorization history and must be retained.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.booking_financial_reconciliations WHERE booking_id = _booking_id)
     OR EXISTS (SELECT 1 FROM public.booking_financial_ledger WHERE booking_id = _booking_id)
     OR EXISTS (SELECT 1 FROM public.booking_audit_events WHERE booking_id = _booking_id)
     OR EXISTS (SELECT 1 FROM public.after_trip_charges WHERE booking_id = _booking_id)
     OR EXISTS (SELECT 1 FROM public.after_trip_reconciliations WHERE booking_id = _booking_id)
     OR EXISTS (SELECT 1 FROM public.after_trip_charge_settlements WHERE booking_id = _booking_id) THEN
    RAISE EXCEPTION 'This booking has retained financial or operational history and cannot be permanently deleted.';
  END IF;

  -- Eligible test/invalid booking media has no retained after-trip history.
  DELETE FROM public.rental_images WHERE booking_id = _booking_id;

  -- Accepted agreement snapshots remain immutable outside this narrowly scoped,
  -- transaction-local admin cleanup operation.
  PERFORM set_config('app.admin_booking_delete', 'allowed', true);
  DELETE FROM public.booking_rental_agreements WHERE booking_id = _booking_id;

  DELETE FROM public.bookings WHERE id = _booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;
EXCEPTION
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'This booking has related records that must be retained and cannot be permanently deleted.';
END;
$$;

REVOKE ALL ON FUNCTION public.delete_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_booking(uuid) TO authenticated;