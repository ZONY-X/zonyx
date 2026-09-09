DO $test$
DECLARE
  admin_id uuid; admin_user uuid; guest_id uuid; host_id uuid; vehicle_id uuid;
  test_booking_id uuid; other_booking_id uuid; reconciliation_1 uuid; reconciliation_2 uuid;
  before_total integer; ledger_count integer; audit_count integer; summary jsonb;
BEGIN
  SELECT id, user_id INTO admin_id, admin_user FROM public.profiles WHERE lower(email) = 'zoeysnp@gmail.com';
  SELECT id INTO guest_id FROM public.profiles WHERE id <> admin_id ORDER BY created_at LIMIT 1;
  SELECT id INTO host_id FROM public.profiles WHERE id NOT IN (admin_id, guest_id) ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL OR guest_id IS NULL OR host_id IS NULL THEN RAISE EXCEPTION 'Required profile fixtures unavailable.'; END IF;
  UPDATE public.profiles SET is_host = true WHERE id = host_id;
  INSERT INTO public.vehicles(vehicle_identifier, host_profile_id, brand, name, model, year, category, color, base_daily_rate_cents, vin, plate, location, is_active)
  VALUES ('M4B-SYNTHETIC-TEST', host_id, 'Test', 'M4B', 'M4B', 2026, 'Test', 'Black', 10000, 'M4BTESTVIN', 'M4BTEST', 'Miami Beach', true) RETURNING id INTO vehicle_id;
  INSERT INTO public.bookings(renter_profile_id, host_profile_id, vehicle_id, start_date, end_date, pickup_time, dropoff_time, trip_status, subtotal_cents, service_fee_cents, taxes_cents, grand_total_cents, currency, authorization_hold_amount_cents)
  VALUES (guest_id, host_id, vehicle_id, '2038-01-01', '2038-01-02', '10:00', '10:00', 'completed', 24900, 2988, 1992, 29880, 'usd', 75000)
  RETURNING id, grand_total_cents INTO test_booking_id, before_total;

  PERFORM set_config('role', 'service_role', true);
  reconciliation_1 := public.persist_booking_financial_reconciliation(
    test_booking_id, 'm4b:test:key', 'Historical Stripe evidence', '2026-09-09T00:00:00Z',
    jsonb_build_object('safe', 'snapshot'), jsonb_build_object('grand_total_cents', 29880), ARRAY['pi_ambiguous'], admin_id,
    jsonb_build_array(
      jsonb_build_object('stable_key','booking:rental_subtotal','entry_type','booking_component','category','rental_subtotal','amount_cents',24900,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Original rental subtotal','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
      jsonb_build_object('stable_key','booking:service_fee','entry_type','booking_component','category','service_fee','amount_cents',2988,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Original service fee','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
      jsonb_build_object('stable_key','booking:taxes','entry_type','booking_component','category','taxes','amount_cents',1992,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Original taxes','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
      jsonb_build_object('stable_key','adjustment:cs_test','entry_type','adjustment','category','historical_stripe_total_correction','amount_cents',10120,'currency','usd','effect','trip_debit','status','posted','source','stripe_checkout','external_reference','cs_test','description','Stripe total correction','occurred_at','2026-08-01T01:00:00Z','metadata','{}'::jsonb),
      jsonb_build_object('stable_key','payment:pi_pay','entry_type','payment','category','rental_payment','amount_cents',40000,'currency','usd','effect','payment','status','succeeded','source','stripe_payment_intent','external_reference','pi_pay','description','Rental payment','occurred_at','2026-08-01T01:00:00Z','metadata','{}'::jsonb),
      jsonb_build_object('stable_key','deposit-authorization:pi_hold','entry_type','deposit_authorization','category','security_deposit','amount_cents',75000,'currency','usd','effect','authorization','status','succeeded','source','stripe_payment_intent','external_reference','pi_hold','description','Deposit authorization','occurred_at','2026-08-01T01:00:00Z','metadata',jsonb_build_object('admin_approved_ambiguous',true)),
      jsonb_build_object('stable_key','deposit-capture:pi_hold','entry_type','deposit_capture','category','security_deposit','amount_cents',9312,'currency','usd','effect','deposit_capture','status','succeeded','source','stripe_evidence','external_reference','pi_hold','description','Deposit capture','occurred_at','2026-08-01T02:00:00Z','metadata','{}'::jsonb),
      jsonb_build_object('stable_key','deposit-release:pi_hold','entry_type','deposit_release','category','security_deposit','amount_cents',65688,'currency','usd','effect','deposit_release','status','settled','source','stripe_evidence','external_reference','pi_hold','description','Deposit release','occurred_at','2026-08-01T02:00:00Z','metadata','{}'::jsonb)
    )
  );
  reconciliation_2 := public.persist_booking_financial_reconciliation(test_booking_id, 'm4b:test:key', 'Retry same confirmation', '2026-09-09T00:00:00Z', '{}', '{}', ARRAY[]::text[], admin_id, '[]');
  IF reconciliation_1 <> reconciliation_2 THEN RAISE EXCEPTION 'Idempotency failed.'; END IF;
  SELECT count(*) INTO ledger_count FROM public.booking_financial_ledger l WHERE l.booking_id = test_booking_id;
  SELECT count(*) INTO audit_count FROM public.booking_audit_events a WHERE a.booking_id = test_booking_id AND a.action_type = 'financial_reconciliation';
  IF ledger_count <> 8 OR audit_count <> 1 THEN RAISE EXCEPTION 'Duplicate/missing persistence: ledger %, audit %.', ledger_count, audit_count; END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', (SELECT user_id::text FROM public.profiles WHERE id = guest_id), true);
  summary := public.get_booking_financial_summary(test_booking_id);
  IF (summary->>'original_trip_amount_cents')::integer <> 29880 OR (summary->>'final_trip_total_cents')::integer <> 40000 OR (summary->>'amount_paid_cents')::integer <> 40000 OR (summary->>'balance_cents')::integer <> 0 OR (summary->>'deposit_captured_cents')::integer <> 9312 OR (summary->>'deposit_released_cents')::integer <> 65688 OR NOT (summary->>'deposit_settled')::boolean THEN RAISE EXCEPTION 'Financial summary mismatch: %', summary; END IF;
  BEGIN
    PERFORM public.persist_booking_financial_reconciliation(test_booking_id, 'guest-key', 'Guest attempt', now(), '{}', '{}', ARRAY[]::text[], guest_id, '[]');
    RAISE EXCEPTION 'Guest persistence unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest persistence unexpectedly%' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.booking_financial_ledger l WHERE l.booking_id = test_booking_id) THEN RAISE EXCEPTION 'Guest raw ledger read unexpectedly allowed.'; END IF;
  BEGIN
    PERFORM public.admin_correct_historical_booking_schedule(test_booking_id, '2038-01-03', '10:00', '2038-01-04', '10:00', 'Guest attempt');
    RAISE EXCEPTION 'Guest correction unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest correction unexpectedly%' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claim.sub', (SELECT user_id::text FROM public.profiles WHERE id = host_id), true);
  BEGIN
    PERFORM public.persist_booking_financial_reconciliation(test_booking_id, 'host-key', 'Host attempt', now(), '{}', '{}', ARRAY[]::text[], host_id, '[]');
    RAISE EXCEPTION 'Host persistence unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Host persistence unexpectedly%' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.booking_financial_reconciliations r WHERE r.booking_id = test_booking_id) THEN RAISE EXCEPTION 'Host raw reconciliation read unexpectedly allowed.'; END IF;
  BEGIN
    PERFORM public.admin_correct_historical_booking_schedule(test_booking_id, '2038-01-03', '10:00', '2038-01-04', '10:00', 'Host attempt');
    RAISE EXCEPTION 'Host correction unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Host correction unexpectedly%' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claim.sub', admin_user::text, true);
  PERFORM public.admin_correct_historical_booking_schedule(test_booking_id, '2038-01-03', '11:00', '2038-01-04', '12:00', 'Historical evidence correction');
  IF (SELECT grand_total_cents FROM public.bookings WHERE id = test_booking_id) <> before_total THEN RAISE EXCEPTION 'Schedule correction changed financial total.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_audit_events a WHERE a.booking_id = test_booking_id AND a.action_type = 'historical_schedule_correction' AND a.before_state->>'start_date' = '2038-01-01' AND a.after_state->>'start_date' = '2038-01-03') THEN RAISE EXCEPTION 'Schedule audit missing.'; END IF;

  PERFORM set_config('role', 'service_role', true);
  INSERT INTO public.bookings(renter_profile_id, host_profile_id, vehicle_id, start_date, end_date, pickup_time, dropoff_time, trip_status, subtotal_cents, service_fee_cents, taxes_cents, grand_total_cents, currency, authorization_hold_amount_cents)
  VALUES (guest_id, host_id, vehicle_id, '2038-02-01', '2038-02-03', '10:00', '10:00', 'confirmed', 10000, 0, 0, 10000, 'usd', 0) RETURNING id INTO other_booking_id;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', admin_user::text, true);
  BEGIN
    PERFORM public.admin_correct_historical_booking_schedule(test_booking_id, '2038-02-02', '10:00', '2038-02-04', '10:00', 'Conflict evidence');
    RAISE EXCEPTION 'Booking conflict unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Booking conflict unexpectedly%' THEN RAISE; END IF; END;
  INSERT INTO public.vehicle_blocked_periods(vehicle_id, host_profile_id, start_at, end_at, reason) VALUES(vehicle_id, host_id, '2038-03-01T10:00:00Z', '2038-03-03T10:00:00Z', 'Synthetic');
  BEGIN
    PERFORM public.admin_correct_historical_booking_schedule(test_booking_id, '2038-03-02', '10:00', '2038-03-04', '10:00', 'Blocked evidence');
    RAISE EXCEPTION 'Blocked conflict unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Blocked conflict unexpectedly%' THEN RAISE; END IF; END;

  PERFORM set_config('role', 'service_role', true);
  BEGIN
    UPDATE public.booking_financial_ledger SET amount_cents = 1 WHERE booking_id = test_booking_id;
    RAISE EXCEPTION 'Ledger mutation unexpectedly allowed.';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Ledger mutation unexpectedly%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS: Module 4B authorization, idempotency, immutable ledger, summary, schedule audit and conflict checks';
END $test$;