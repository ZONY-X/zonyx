BEGIN;

DO $test$
DECLARE
  owner_profile uuid;
  owner_user uuid;
  ordinary_user uuid;
  vehicle uuid;
  agreement_version public.rental_agreement_versions%ROWTYPE;
  eligible_booking constant uuid := 'de1e7e00-0000-4000-8000-000000000001';
  retained_booking constant uuid := 'de1e7e00-0000-4000-8000-000000000002';
BEGIN
  SELECT p.id, p.user_id
  INTO owner_profile, owner_user
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.is_admin
  ORDER BY p.created_at
  LIMIT 1;

  SELECT id INTO vehicle FROM public.vehicles ORDER BY created_at LIMIT 1;
  SELECT user_id INTO ordinary_user
  FROM public.profiles
  WHERE NOT is_admin AND user_id IS NOT NULL
  ORDER BY created_at
  LIMIT 1;
  SELECT * INTO agreement_version
  FROM public.rental_agreement_versions
  WHERE status = 'published'
  ORDER BY effective_at DESC
  LIMIT 1;

  IF owner_profile IS NULL OR owner_user IS NULL OR ordinary_user IS NULL OR vehicle IS NULL OR agreement_version.id IS NULL THEN
    RAISE EXCEPTION 'Required admin, ordinary user, vehicle, or agreement fixtures unavailable.';
  END IF;

  INSERT INTO public.bookings (
    id, reservation_number, renter_profile_id, host_profile_id, vehicle_id,
    start_date, end_date, trip_status, currency
  ) VALUES
    (eligible_booking, 'DELETE-ELIGIBLE-TEST', owner_profile, owner_profile, vehicle, '2039-01-01', '2039-01-02', 'pending_payment', 'usd'),
    (retained_booking, 'DELETE-RETAINED-TEST', owner_profile, owner_profile, vehicle, '2039-01-03', '2039-01-04', 'cancelled', 'usd');

  INSERT INTO public.booking_rental_agreements (
    id, booking_id, proposed_booking_id, master_agreement_id, master_version,
    guest_profile_id, guest_auth_user_id, accepted_at, trip_financial_summary,
    rendered_text, document_hash, idempotency_key, preparation_expires_at
  ) VALUES (
    'de1e7e00-0000-4000-8000-000000000011', eligible_booking, eligible_booking,
    agreement_version.id, agreement_version.version, owner_profile, owner_user, now(),
    '{}'::jsonb, 'Synthetic accepted agreement', repeat('a', 64),
    'delete-eligible-test', now() + interval '1 hour'
  );

  INSERT INTO public.booking_audit_events (
    booking_id, action_type, reason, actor_profile_id
  ) VALUES (
    retained_booking, 'delete_retention_test', 'Synthetic retained history', owner_profile
  );

  BEGIN
    DELETE FROM public.booking_rental_agreements WHERE booking_id = eligible_booking;
    RAISE EXCEPTION 'Accepted agreement direct delete unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Accepted agreement direct delete unexpectedly succeeded.' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Accepted Rental Agreement history is immutable.%' THEN RAISE; END IF;
  END;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', ordinary_user::text, true);
  BEGIN
    PERFORM public.delete_booking(eligible_booking);
    RAISE EXCEPTION 'Non-admin booking deletion unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Non-admin booking deletion unexpectedly succeeded.' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Only admins can permanently delete bookings.%' THEN RAISE; END IF;
  END;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', owner_user::text, true);

  PERFORM public.delete_booking(eligible_booking);

  PERFORM set_config('role', 'service_role', true);
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = eligible_booking)
     OR EXISTS (SELECT 1 FROM public.booking_rental_agreements WHERE booking_id = eligible_booking) THEN
    RAISE EXCEPTION 'Eligible booking and agreement were not deleted atomically.';
  END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', owner_user::text, true);
  BEGIN
    PERFORM public.delete_booking(retained_booking);
    RAISE EXCEPTION 'Booking with retained audit history unexpectedly deleted.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Booking with retained audit history unexpectedly deleted.' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%retained financial or operational history%' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = retained_booking)
     OR NOT EXISTS (SELECT 1 FROM public.booking_audit_events WHERE booking_id = retained_booking) THEN
    RAISE EXCEPTION 'Rejected deletion did not preserve booking audit history.';
  END IF;

  RAISE NOTICE 'PASS: authorized atomic booking/agreement deletion and retained-history rejection';
END $test$;

ROLLBACK;