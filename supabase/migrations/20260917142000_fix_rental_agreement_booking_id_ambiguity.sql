-- Remove the PL/pgSQL variable/column ambiguity in Rental Agreement acceptance.
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
  IF NOT (
    summary ?& ARRAY['reservation_number','vehicle_id','host_profile_id','start_date','end_date','pickup_time','dropoff_time','pickup_location','dropoff_location',
      'subtotal_cents','service_fee_cents','taxes_cents','final_total_cents','currency','authorization_hold_amount_cents',
      'mileage_calculation_method','included_mileage_allowance','additional_mile_rate_cents','authorized_drivers','additional_booking_specific_terms']
  ) THEN RAISE EXCEPTION 'Prepared Rental Agreement is incomplete.'; END IF;
  requested_start_ts := (summary->>'start_date')::date::timestamp + (summary->>'pickup_time')::time;
  requested_end_ts := (summary->>'end_date')::date::timestamp + (summary->>'dropoff_time')::time;
  IF requested_end_ts <= requested_start_ts THEN RAISE EXCEPTION 'Drop-off must be after pickup.'; END IF;

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
