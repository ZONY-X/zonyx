-- Existing host/admin vehicle RLS governs this setting; no new admin system.
ALTER TABLE public.vehicles ADD COLUMN minimum_rental_hours integer NOT NULL DEFAULT 1 CHECK (minimum_rental_hours BETWEEN 1 AND 8760);
UPDATE public.vehicles SET minimum_rental_hours=25 WHERE vehicle_identifier='ZONYX-CT-AWD-001';
CREATE FUNCTION public.validate_vehicle_rental_duration(_vehicle_id uuid,_start_date date,_pickup_time time,_end_date date,_dropoff_time time) RETURNS integer LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE minimum_hours integer; duration_hours numeric;
BEGIN
 SELECT minimum_rental_hours INTO minimum_hours FROM vehicles WHERE id=_vehicle_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle unavailable'; END IF;
 IF _start_date IS NULL OR _pickup_time IS NULL OR _end_date IS NULL OR _dropoff_time IS NULL THEN RAISE EXCEPTION 'Complete pickup and return times required'; END IF;
 duration_hours:=extract(epoch from ((_end_date::timestamp+_dropoff_time)-(_start_date::timestamp+_pickup_time)))/3600;
 IF duration_hours<minimum_hours THEN RAISE EXCEPTION 'This vehicle requires a minimum rental of % hours. Update the dates and review the price before payment.',minimum_hours; END IF;
 RETURN calculate_rental_days(_start_date,_pickup_time,_end_date,_dropoff_time);
END; $$;
REVOKE ALL ON FUNCTION validate_vehicle_rental_duration(uuid,date,time,date,time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_vehicle_rental_duration(uuid,date,time,date,time) TO anon,authenticated,service_role;
CREATE FUNCTION public.enforce_booking_minimum_duration() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' OR ROW(NEW.vehicle_id,NEW.start_date,NEW.end_date,NEW.pickup_time,NEW.dropoff_time) IS DISTINCT FROM ROW(OLD.vehicle_id,OLD.start_date,OLD.end_date,OLD.pickup_time,OLD.dropoff_time) THEN
  PERFORM validate_vehicle_rental_duration(NEW.vehicle_id,NEW.start_date,NEW.pickup_time,NEW.end_date,NEW.dropoff_time);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER z_booking_minimum_duration BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_minimum_duration();
CREATE FUNCTION public.enforce_payment_minimum_duration() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE b bookings%ROWTYPE;a booking_rental_agreements%ROWTYPE;days integer;rate bigint;
BEGIN
 IF NEW.state IN ('creating','capturing') THEN
  SELECT * INTO b FROM bookings WHERE id=NEW.booking_id;
  days:=validate_vehicle_rental_duration(b.vehicle_id,b.start_date,b.pickup_time,b.end_date,b.dropoff_time);
  SELECT * INTO a FROM booking_rental_agreements WHERE id=NEW.agreement_id;
  SELECT base_daily_rate_cents INTO rate FROM vehicles WHERE id=b.vehicle_id;
  IF a.trip_financial_summary->>'internal_test' IS DISTINCT FROM 'true' AND ((a.trip_financial_summary->>'rental_days')::integer IS DISTINCT FROM days OR (a.trip_financial_summary->>'daily_rate_cents')::bigint IS DISTINCT FROM rate) THEN RAISE EXCEPTION 'Rental quote is stale. Review current dates and pricing before payment.'; END IF;
  IF a.trip_financial_summary->>'promo_code'='ZONYX47' AND ((a.trip_financial_summary->>'promo_discount_cents')::bigint IS DISTINCT FROM 4700 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(a.trip_financial_summary->'add_ons','[]'::jsonb)) item WHERE item->>'key' IN ('airport_delivery','custom_destination') AND (item->>'amount_cents')::bigint IS DISTINCT FROM 0)) THEN RAISE EXCEPTION 'Introductory promotion quote is stale. Review current pricing before payment.'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER a_payment_minimum_duration BEFORE INSERT OR UPDATE ON public.booking_payments FOR EACH ROW EXECUTE FUNCTION enforce_payment_minimum_duration();
REVOKE ALL ON FUNCTION enforce_booking_minimum_duration(),enforce_payment_minimum_duration() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION enforce_booking_minimum_duration(),enforce_payment_minimum_duration() TO service_role;
