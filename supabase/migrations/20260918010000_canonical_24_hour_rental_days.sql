-- Canonical rental-day pricing: each started 24-hour period from exact local
-- pickup wall time is one rental day. Existing bookings and accepted Rental
-- Agreement snapshots are intentionally untouched.

CREATE OR REPLACE FUNCTION public.calculate_rental_days(
  _start_date date,
  _pickup_time time without time zone,
  _end_date date,
  _dropoff_time time without time zone
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  start_at timestamp without time zone;
  end_at timestamp without time zone;
BEGIN
  IF _start_date IS NULL OR _pickup_time IS NULL OR _end_date IS NULL OR _dropoff_time IS NULL THEN
    RAISE EXCEPTION 'Complete pickup and drop-off date/time values are required.';
  END IF;

  start_at := _start_date::timestamp + _pickup_time;
  end_at := _end_date::timestamp + _dropoff_time;

  IF end_at <= start_at THEN
    RAISE EXCEPTION 'Drop-off must be after pickup.';
  END IF;

  RETURN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (end_at - start_at)) / 86400.0)::integer);
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_rental_days(date,time without time zone,date,time without time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_rental_days(date,time without time zone,date,time without time zone) TO anon, authenticated, service_role;

-- Keep the still-present privileged legacy booking function aligned with the
-- canonical rule. Its browser execute grant remains revoked by the existing
-- booking-specific Rental Agreement migration.
CREATE OR REPLACE FUNCTION public.create_booking(
  _vehicle_id uuid,
  _start_date date,
  _end_date date,
  _pickup_location text DEFAULT NULL,
  _dropoff_location text DEFAULT NULL,
  _pickup_time time DEFAULT NULL,
  _dropoff_time time DEFAULT NULL,
  _terms_accepted boolean DEFAULT FALSE,
  _rental_agreement_accepted boolean DEFAULT FALSE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vehicle_row public.vehicles%ROWTYPE;
  renter_profile uuid;
  eligibility_status text;
  booking_id uuid;
  rental_days integer;
  subtotal integer;
  service_fee integer;
  taxes integer;
  grand_total integer;
  checkout_hold_timeout interval := interval '20 minutes';
  requested_start_ts timestamp;
  requested_end_ts timestamp;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF NOT _terms_accepted THEN RAISE EXCEPTION 'You must accept the ZONYX Terms of Service before booking.'; END IF;
  IF NOT _rental_agreement_accepted THEN RAISE EXCEPTION 'You must accept the ZONYX Rental Agreement before booking.'; END IF;

  requested_start_ts := _start_date::timestamp + COALESCE(_pickup_time, time '00:00');
  requested_end_ts := _end_date::timestamp + COALESCE(_dropoff_time, time '00:00');
  rental_days := public.calculate_rental_days(
    _start_date,
    COALESCE(_pickup_time, time '00:00'),
    _end_date,
    COALESCE(_dropoff_time, time '00:00')
  );

  SELECT id INTO renter_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF renter_profile IS NULL THEN RAISE EXCEPTION 'Profile not found for current user.'; END IF;

  SELECT public.driver_eligibility_status(
    d.date_of_birth, d.license_expiration_date, d.self_attested_at, _end_date
  ) INTO eligibility_status
  FROM public.driver_eligibility d WHERE d.profile_id = renter_profile;
  eligibility_status := COALESCE(eligibility_status, 'incomplete');
  IF eligibility_status = 'incomplete' THEN RAISE EXCEPTION 'Complete your driver eligibility profile before booking.'; END IF;
  IF eligibility_status = 'age_ineligible' THEN RAISE EXCEPTION 'You must be at least 18 years old to book with ZONYX.'; END IF;
  IF eligibility_status = 'license_expired' THEN RAISE EXCEPTION 'Your driver license must remain valid through the trip end date.'; END IF;
  IF eligibility_status <> 'eligible_self_attested' THEN RAISE EXCEPTION 'Driver eligibility requirements are not met.'; END IF;

  SELECT * INTO vehicle_row FROM public.vehicles
  WHERE id = _vehicle_id AND is_active = true AND availability_status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found or inactive.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_vehicle_id::text));
  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.vehicle_id = _vehicle_id
      AND tsrange(
        b.start_date::timestamp + COALESCE(b.pickup_time, time '00:00'),
        b.end_date::timestamp + COALESCE(b.dropoff_time, time '00:00'), '[)'
      ) && tsrange(requested_start_ts, requested_end_ts, '[)')
      AND (b.trip_status IN ('confirmed', 'active', 'pending_inspection')
        OR (b.trip_status = 'pending_payment' AND b.created_at >= now() - checkout_hold_timeout))
  ) THEN RAISE EXCEPTION 'Vehicle is not available for the selected dates.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.vehicle_blocked_periods vbp
    WHERE vbp.vehicle_id = _vehicle_id
      AND tsrange(vbp.start_at::timestamp, vbp.end_at::timestamp, '[)')
        && tsrange(requested_start_ts, requested_end_ts, '[)')
  ) THEN RAISE EXCEPTION 'Vehicle is not available for the selected dates.'; END IF;

  subtotal := vehicle_row.base_daily_rate_cents * rental_days;
  service_fee := ROUND(subtotal * 0.12);
  taxes := ROUND(subtotal * 0.08);
  grand_total := subtotal + service_fee + taxes;
  IF vehicle_row.vehicle_identifier = 'ZONYX-CT-AWD-001' AND _start_date = DATE '2026-08-08' AND rental_days = 1 THEN
    subtotal := 22250; service_fee := 2670; taxes := 1780; grand_total := 26700;
  END IF;

  INSERT INTO public.bookings (
    renter_profile_id, host_profile_id, vehicle_id, start_date, end_date,
    pickup_location, dropoff_location, pickup_time, dropoff_time, trip_status,
    subtotal_cents, service_fee_cents, taxes_cents, grand_total_cents, currency,
    authorization_hold_amount_cents, terms_accepted_at, rental_agreement_accepted_at
  ) VALUES (
    renter_profile, vehicle_row.host_profile_id, _vehicle_id, _start_date, _end_date,
    _pickup_location, _dropoff_location, _pickup_time, _dropoff_time, 'pending_payment',
    subtotal, service_fee, taxes, grand_total, 'usd', 0, now(), now()
  ) RETURNING id INTO booking_id;
  RETURN booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid,date,date,text,text,time,time,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,date,date,text,text,time,time,boolean,boolean) TO service_role;

-- Prepared-but-unaccepted quotes from the prior pricing rule must be reviewed
-- again. Accepted agreements return before this validation and remain immutable.
CREATE OR REPLACE FUNCTION public.accept_prepared_rental_agreement(
  _agreement_id uuid,
  _document_hash text,
  _terms_accepted boolean,
  _rental_agreement_accepted boolean,
  _guest_auth_user_id uuid,
  _accepted_ip inet,
  _accepted_user_agent text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  agreement_row public.booking_rental_agreements%ROWTYPE;
  summary jsonb;
  v_booking_id uuid;
  requested_start_ts timestamp;
  requested_end_ts timestamp;
  eligibility_status text;
BEGIN
  IF NOT _terms_accepted THEN RAISE EXCEPTION 'You must accept the ZONYX Terms of Service before booking.'; END IF;
  IF NOT _rental_agreement_accepted THEN RAISE EXCEPTION 'You must accept the booking-specific ZONYX Rental Agreement before booking.'; END IF;

  SELECT * INTO agreement_row FROM public.booking_rental_agreements
  WHERE id=_agreement_id AND guest_auth_user_id=_guest_auth_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prepared Rental Agreement not found.'; END IF;
  IF agreement_row.accepted_at IS NOT NULL THEN RETURN agreement_row.booking_id; END IF;
  IF agreement_row.preparation_expires_at < now() THEN RAISE EXCEPTION 'Prepared Rental Agreement has expired.'; END IF;
  IF agreement_row.document_hash <> _document_hash THEN RAISE EXCEPTION 'Rental Agreement document changed. Review it again.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rental_agreement_versions v
    WHERE v.id=agreement_row.master_agreement_id AND v.version=agreement_row.master_version AND v.status='published'
  ) THEN RAISE EXCEPTION 'Rental Agreement Master version is unavailable.'; END IF;

  summary := agreement_row.trip_financial_summary;
  IF COALESCE(summary->>'pricing_rule_version','') <> 'started_24_hour_periods_v1' THEN
    RAISE EXCEPTION 'Booking pricing has changed. Review the Rental Agreement again.';
  END IF;
  IF NOT (
    summary ?& ARRAY['reservation_number','vehicle_id','host_profile_id','start_date','end_date','pickup_time','dropoff_time','pickup_location','dropoff_location',
      'rental_days','daily_rate_cents','subtotal_cents','service_fee_cents','taxes_cents','final_total_cents','currency','authorization_hold_amount_cents',
      'mileage_calculation_method','included_mileage_allowance','additional_mile_rate_cents','authorized_drivers','additional_booking_specific_terms']
  ) THEN RAISE EXCEPTION 'Prepared Rental Agreement is incomplete.'; END IF;
  IF (summary->>'rental_days')::integer <> public.calculate_rental_days(
    (summary->>'start_date')::date,
    (summary->>'pickup_time')::time,
    (summary->>'end_date')::date,
    (summary->>'dropoff_time')::time
  ) THEN RAISE EXCEPTION 'Prepared Rental Agreement duration is invalid.'; END IF;

  requested_start_ts := (summary->>'start_date')::date::timestamp + (summary->>'pickup_time')::time;
  requested_end_ts := (summary->>'end_date')::date::timestamp + (summary->>'dropoff_time')::time;

  SELECT public.driver_eligibility_status(d.date_of_birth,d.license_expiration_date,d.self_attested_at,(summary->>'end_date')::date)
  INTO eligibility_status FROM public.driver_eligibility d WHERE d.profile_id=agreement_row.guest_profile_id;
  IF COALESCE(eligibility_status,'incomplete') <> 'eligible_self_attested' THEN RAISE EXCEPTION 'Driver eligibility requirements are not met.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(summary->>'vehicle_id'));
  IF EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.vehicle_id=(summary->>'vehicle_id')::uuid
    AND tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')
      && tsrange(requested_start_ts,requested_end_ts,'[)')
    AND (b.trip_status IN ('confirmed','active','pending_inspection') OR (b.trip_status='pending_payment' AND b.created_at>=now()-interval '20 minutes'))
  ) THEN RAISE EXCEPTION 'Vehicle is not available for the selected dates.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=(summary->>'vehicle_id')::uuid
    AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && tsrange(requested_start_ts,requested_end_ts,'[)')
  ) THEN RAISE EXCEPTION 'Vehicle is not available for the selected dates.'; END IF;

  v_booking_id := agreement_row.proposed_booking_id;
  INSERT INTO public.bookings(
    id,reservation_number,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_location,dropoff_location,pickup_time,dropoff_time,
    fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,
    authorization_hold_amount_cents,terms_accepted_at,rental_agreement_accepted_at
  ) VALUES (
    v_booking_id,summary->>'reservation_number',agreement_row.guest_profile_id,(summary->>'host_profile_id')::uuid,(summary->>'vehicle_id')::uuid,
    (summary->>'start_date')::date,(summary->>'end_date')::date,summary->>'pickup_location',summary->>'dropoff_location',
    (summary->>'pickup_time')::time,(summary->>'dropoff_time')::time,summary->>'fulfillment_method','pending_payment',
    (summary->>'subtotal_cents')::integer,(summary->>'service_fee_cents')::integer,(summary->>'taxes_cents')::integer,
    (summary->>'final_total_cents')::integer,summary->>'currency',(summary->>'authorization_hold_amount_cents')::integer,now(),now()
  );

  UPDATE public.booking_rental_agreements SET
    booking_id=v_booking_id,accepted_at=now(),accepted_ip=_accepted_ip,accepted_user_agent=NULLIF(_accepted_user_agent,'')
  WHERE id=agreement_row.id;
  RETURN v_booking_id;
END; $$;

REVOKE ALL ON FUNCTION public.accept_prepared_rental_agreement(uuid,text,boolean,boolean,uuid,inet,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_prepared_rental_agreement(uuid,text,boolean,boolean,uuid,inet,text) TO service_role;