-- Module 1B: operational security-deposit release/capture support.
-- Additive only: no existing column is modified or removed.
alter table public.bookings
  add column if not exists authorization_hold_captured_amount_cents integer,
  add column if not exists authorization_hold_released_at timestamptz,
  add column if not exists authorization_hold_captured_at timestamptz;

-- Server-side persistence of a Stripe-confirmed hold outcome. Re-verifies
-- host/admin authorization so the edge function cannot be bypassed.
CREATE OR REPLACE FUNCTION public.persist_authorization_hold_outcome(
  _booking_id uuid,
  _status text,
  _captured_amount_cents integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  booking_row public.bookings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO booking_row
  FROM public.bookings WHERE id = _booking_id LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;

  IF NOT (
    public.current_profile_is_admin()
    OR booking_row.host_profile_id = public.current_profile_id()
  ) THEN
    RAISE EXCEPTION 'Only the host or an admin can manage this deposit.';
  END IF;

  IF _status NOT IN ('released', 'captured') THEN
    RAISE EXCEPTION 'Invalid deposit status.';
  END IF;

  IF _status = 'captured' THEN
    IF _captured_amount_cents IS NULL OR _captured_amount_cents <= 0 THEN
      RAISE EXCEPTION 'Captured amount must be positive.';
    END IF;
    UPDATE public.bookings
    SET authorization_hold_status = 'captured',
        authorization_hold_captured_amount_cents = _captured_amount_cents,
        authorization_hold_captured_at = now(),
        updated_at = now()
    WHERE id = _booking_id;
  ELSE
    UPDATE public.bookings
    SET authorization_hold_status = 'released',
        authorization_hold_released_at = now(),
        updated_at = now()
    WHERE id = _booking_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.persist_authorization_hold_outcome(uuid, text, integer) TO authenticated;

