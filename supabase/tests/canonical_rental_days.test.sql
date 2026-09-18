DO $test$
DECLARE
  value integer;
  availability_definition text;
  search_definition text;
BEGIN
  value := public.calculate_rental_days('2038-09-30', '13:00', '2038-10-01', '12:59');
  IF value <> 1 THEN RAISE EXCEPTION '23h59m expected 1, got %', value; END IF;

  value := public.calculate_rental_days('2038-09-30', '13:00', '2038-10-01', '13:00');
  IF value <> 1 THEN RAISE EXCEPTION '24h expected 1, got %', value; END IF;

  value := public.calculate_rental_days('2038-09-30', '13:00', '2038-10-01', '13:01');
  IF value <> 2 THEN RAISE EXCEPTION '24h01m expected 2, got %', value; END IF;

  value := public.calculate_rental_days('2038-09-30', '13:00', '2038-10-01', '21:00');
  IF value <> 2 THEN RAISE EXCEPTION '32h expected 2, got %', value; END IF;

  value := public.calculate_rental_days('2038-09-30', '13:00', '2038-10-02', '13:00');
  IF value <> 2 THEN RAISE EXCEPTION '48h expected 2, got %', value; END IF;

  value := public.calculate_rental_days('2038-09-30', '13:00', '2038-10-02', '13:01');
  IF value <> 3 THEN RAISE EXCEPTION '48h01m expected 3, got %', value; END IF;

  BEGIN
    PERFORM public.calculate_rental_days('2038-09-30', '13:00', '2038-09-30', '13:00');
    RAISE EXCEPTION 'Zero duration unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Zero duration unexpectedly%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.calculate_rental_days('2038-09-30', '13:00', '2038-09-30', '12:59');
    RAISE EXCEPTION 'Negative duration unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Negative duration unexpectedly%' THEN RAISE; END IF;
  END;

  -- Phase 1 must not alter the canonical booking/block overlap functions.
  SELECT pg_get_functiondef('public.check_vehicle_availability(uuid,date,date,time without time zone,time without time zone)'::regprocedure)
    INTO availability_definition;
  SELECT pg_get_functiondef('public.search_available_vehicles(date,date,time without time zone,time without time zone,text)'::regprocedure)
    INTO search_definition;
  IF availability_definition NOT LIKE '%vehicle_blocked_periods%'
     OR availability_definition NOT LIKE '%tsrange%'
     OR search_definition NOT LIKE '%vehicle_blocked_periods%'
     OR search_definition NOT LIKE '%tsrange%'
  THEN
    RAISE EXCEPTION 'Availability booking/block overlap enforcement changed or is missing.';
  END IF;

  RAISE NOTICE 'PASS: canonical started-24-hour rental-day boundaries and unchanged availability enforcement';
END $test$;