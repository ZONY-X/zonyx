-- Host/admin operational booking controls: edit pickup/drop-off times and
-- correct booking-level pricing before a Stripe checkout session is opened.
--
-- Bookings direct UPDATE is denied by RLS ("Bookings direct update denied"), so
-- this SECURITY DEFINER RPC is the safe server-side path, mirroring the existing
-- cancel_booking / delete_booking pattern.
--
-- Price fields are ONLY editable while:
--   * trip_status = 'pending_payment'  (payment has not been captured), AND
--   * stripe_checkout_session_id IS NULL (no checkout session opened yet)
-- This prevents silently mutating already-captured Stripe charges.
--
-- The vehicle's base_daily_rate_cents is intentionally NOT touched here. This
-- function only corrects the price on the individual booking record.

CREATE OR REPLACE FUNCTION public.update_booking_operational_details(
  _booking_id uuid,
  _pickup_time time DEFAULT NULL,
  _dropoff_time time DEFAULT NULL,
  _subtotal_cents integer DEFAULT NULL,
  _service_fee_cents integer DEFAULT NULL,
  _taxes_cents integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  booking_row public.bookings%ROWTYPE;
  new_pickup_time time;
  new_dropoff_time time;
  new_subtotal integer;
  new_service_fee integer;
  new_taxes integer;
  new_grand_total integer;
  requested_start_ts timestamp;
  requested_end_ts timestamp;
  price_requested boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT *
  INTO booking_row
  FROM public.bookings
  WHERE id = _booking_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;

  IF NOT (
    public.current_profile_is_admin()
    OR booking_row.host_profile_id = public.current_profile_id()
  ) THEN
    RAISE EXCEPTION 'Only the host or an admin can update this booking.';
  END IF;

  IF booking_row.trip_status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Booking is no longer editable.';
  END IF;

  new_pickup_time := COALESCE(_pickup_time, booking_row.pickup_time);
  new_dropoff_time := COALESCE(_dropoff_time, booking_row.dropoff_time);

  IF new_pickup_time IS NOT NULL OR new_dropoff_time IS NOT NULL THEN
    requested_start_ts := booking_row.start_date::timestamp + COALESCE(new_pickup_time, time '00:00');
    requested_end_ts := booking_row.end_date::timestamp + COALESCE(new_dropoff_time, time '00:00');
    IF requested_end_ts <= requested_start_ts THEN
      RAISE EXCEPTION 'Drop-off must be after pickup.';
    END IF;
  END IF;

  price_requested := (
    _subtotal_cents IS NOT NULL
    OR _service_fee_cents IS NOT NULL
    OR _taxes_cents IS NOT NULL
  );

  IF price_requested THEN
    IF booking_row.trip_status <> 'pending_payment' THEN
      RAISE EXCEPTION 'Price can only be corrected while payment is still pending.';
    END IF;
    IF booking_row.stripe_checkout_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'Price can only be corrected before a checkout session is opened.';
    END IF;

    new_subtotal := COALESCE(_subtotal_cents, booking_row.subtotal_cents);
    new_service_fee := COALESCE(_service_fee_cents, booking_row.service_fee_cents);
    new_taxes := COALESCE(_taxes_cents, booking_row.taxes_cents);

    IF new_subtotal < 0 OR new_service_fee < 0 OR new_taxes < 0 THEN
      RAISE EXCEPTION 'Price values cannot be negative.';
    END IF;

    new_grand_total := new_subtotal + new_service_fee + new_taxes;
  ELSE
    new_subtotal := booking_row.subtotal_cents;
    new_service_fee := booking_row.service_fee_cents;
    new_taxes := booking_row.taxes_cents;
    new_grand_total := booking_row.grand_total_cents;
  END IF;

  UPDATE public.bookings
  SET pickup_time = new_pickup_time,
      dropoff_time = new_dropoff_time,
      subtotal_cents = new_subtotal,
      service_fee_cents = new_service_fee,
      taxes_cents = new_taxes,
      grand_total_cents = new_grand_total,
      updated_at = now()
  WHERE id = _booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_booking_operational_details(uuid, time, time, integer, integer, integer) TO authenticated;