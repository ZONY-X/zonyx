-- Module 2 follow-up: accept partial search context and validate the existing
-- ZONYX pickup service areas without treating them as vehicle storage addresses.

CREATE OR REPLACE FUNCTION public.search_available_vehicles(
  _start_date date DEFAULT NULL,
  _end_date date DEFAULT NULL,
  _pickup_time time without time zone DEFAULT '10:00',
  _dropoff_time time without time zone DEFAULT '10:00',
  _location text DEFAULT NULL
)
RETURNS SETOF public.vehicles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  hold interval := interval '20 minutes';
  rstart timestamp;
  rend timestamp;
BEGIN
  IF (_start_date IS NULL) <> (_end_date IS NULL) THEN RETURN; END IF;
  IF _start_date IS NOT NULL AND _end_date <= _start_date THEN RETURN; END IF;
  IF NULLIF(trim(_location), '') IS NOT NULL
    AND trim(_location) NOT IN (
      'Coconut Grove', 'Brickell', 'Downtown Miami', 'Wynwood',
      'Miami Beach', 'Coral Gables', 'Edgewater', 'Miami International Airport'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.is_active AND v.availability_status = 'active' AND v.location ILIKE trim(_location)
    )
  THEN RETURN; END IF;

  IF _start_date IS NOT NULL THEN
    rstart := _start_date::timestamp + COALESCE(_pickup_time, time '10:00');
    rend := _end_date::timestamp + COALESCE(_dropoff_time, time '10:00');
  END IF;

  RETURN QUERY
  SELECT v.*
  FROM public.vehicles v
  WHERE v.is_active = true
    AND v.availability_status = 'active'
    AND (_start_date IS NULL OR (
      NOT EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.vehicle_id = v.id
          AND tsrange(
            b.start_date::timestamp + COALESCE(b.pickup_time, time '00:00'),
            b.end_date::timestamp + COALESCE(b.dropoff_time, time '00:00'),
            '[)'
          ) && tsrange(rstart, rend, '[)')
          AND (b.trip_status IN ('confirmed', 'active', 'pending_inspection')
            OR (b.trip_status = 'pending_payment' AND b.created_at >= now() - hold))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.vehicle_blocked_periods vbp
        WHERE vbp.vehicle_id = v.id
          AND tsrange(vbp.start_at::timestamp, vbp.end_at::timestamp, '[)') && tsrange(rstart, rend, '[)')
      )
    ))
  ORDER BY v.display_order ASC NULLS LAST, v.created_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.search_available_vehicles(date, date, time, time, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_vehicle_availability(
  _vehicle_id uuid,
  _start_date date,
  _end_date date,
  _pickup_time time without time zone DEFAULT '00:00',
  _dropoff_time time without time zone DEFAULT '00:00'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  hold interval := interval '20 minutes';
  rstart timestamp;
  rend timestamp;
BEGIN
  IF _end_date <= _start_date THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = _vehicle_id AND v.is_active AND v.availability_status = 'active'
  ) THEN RETURN false; END IF;

  rstart := _start_date::timestamp + COALESCE(_pickup_time, time '00:00');
  rend := _end_date::timestamp + COALESCE(_dropoff_time, time '00:00');

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.vehicle_id = _vehicle_id
      AND tsrange(
        b.start_date::timestamp + COALESCE(b.pickup_time, time '00:00'),
        b.end_date::timestamp + COALESCE(b.dropoff_time, time '00:00'),
        '[)'
      ) && tsrange(rstart, rend, '[)')
      AND (b.trip_status IN ('confirmed', 'active', 'pending_inspection')
        OR (b.trip_status = 'pending_payment' AND b.created_at >= now() - hold))
  ) THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.vehicle_blocked_periods vbp
    WHERE vbp.vehicle_id = _vehicle_id
      AND tsrange(vbp.start_at::timestamp, vbp.end_at::timestamp, '[)') && tsrange(rstart, rend, '[)')
  ) THEN RETURN false; END IF;

  RETURN true;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.check_vehicle_availability(uuid, date, date, time, time) TO anon, authenticated;