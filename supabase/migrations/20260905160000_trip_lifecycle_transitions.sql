-- Module 1A: host/admin trip lifecycle transitions
-- confirmed -> active (start trip)
-- active -> pending_inspection (mark vehicle returned)
-- pending_inspection -> completed (complete trip)
-- Status values are already permitted by bookings_trip_status_check.

CREATE OR REPLACE FUNCTION public.transition_trip_status(
  _booking_id uuid,
  _new_status text
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

  IF _new_status NOT IN ('active', 'pending_inspection', 'completed') THEN
    RAISE EXCEPTION 'Unsupported trip status transition target.';
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
    RAISE EXCEPTION 'Only the host or an admin can update this trip.';
  END IF;

  IF NOT (
    (booking_row.trip_status = 'confirmed' AND _new_status = 'active') OR
    (booking_row.trip_status = 'active' AND _new_status = 'pending_inspection') OR
    (booking_row.trip_status = 'pending_inspection' AND _new_status = 'completed')
  ) THEN
    RAISE EXCEPTION 'Trip cannot move from % to %.', booking_row.trip_status, _new_status;
  END IF;

  UPDATE public.bookings
  SET trip_status = _new_status,
      updated_at = now()
  WHERE id = _booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_trip_status(uuid, text) TO authenticated;
