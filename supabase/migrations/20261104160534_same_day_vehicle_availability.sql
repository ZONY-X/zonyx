-- Compare complete local rental timestamps, not calendar dates. Preserve half-open conflicts and payment holds.
-- Archived reservations must not reserve inventory. Active overlap and block checks remain unchanged.
CREATE OR REPLACE FUNCTION public.check_vehicle_availability(_vehicle_id uuid, _start_date date, _end_date date, _pickup_time time without time zone DEFAULT '00:00:00'::time without time zone, _dropoff_time time without time zone DEFAULT '00:00:00'::time without time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hold interval := interval '20 minutes';
  rstart timestamp;
  rend timestamp;
BEGIN
  IF _start_date IS NULL OR _end_date IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = _vehicle_id AND v.is_active AND v.availability_status = 'active'
  ) THEN RETURN false; END IF;

  rstart := _start_date::timestamp + COALESCE(_pickup_time, time '00:00');
  rend := _end_date::timestamp + COALESCE(_dropoff_time, time '00:00');
  IF rend <= rstart THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.vehicle_id = _vehicle_id
      AND b.archived_at IS NULL
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
$function$
;


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
    IF rend <= rstart THEN RETURN; END IF;
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
          AND b.archived_at IS NULL
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

-- The persisted reservation must accept the same positive hourly interval as the availability API.
ALTER TABLE public.bookings DROP CONSTRAINT bookings_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_check CHECK (
  end_date::timestamp + COALESCE(dropoff_time,time '00:00') > start_date::timestamp + COALESCE(pickup_time,time '00:00')
);
ALTER TABLE public.reservation_agreement_contexts DROP CONSTRAINT reservation_agreement_contexts_check;
ALTER TABLE public.reservation_agreement_contexts ADD CONSTRAINT reservation_agreement_contexts_check CHECK (
  end_date::timestamp + dropoff_time > start_date::timestamp + pickup_time
);
