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

