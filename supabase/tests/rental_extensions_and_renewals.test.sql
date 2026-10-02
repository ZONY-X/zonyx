BEGIN;

DO $$
BEGIN
 IF public.monthly_anniversary_date(date '2026-10-21',1,21)<>date '2026-11-21' THEN RAISE EXCEPTION 'One-month anniversary failed'; END IF;
 IF public.monthly_anniversary_date(date '2026-10-21',3,21)<>date '2027-01-21' THEN RAISE EXCEPTION 'Multi-month anniversary failed'; END IF;
 IF public.monthly_anniversary_date(date '2027-01-31',1,31)<>date '2027-02-28' THEN RAISE EXCEPTION 'February clamp failed'; END IF;
 IF public.monthly_anniversary_date(date '2027-01-31',2,31)<>date '2027-03-31' THEN RAISE EXCEPTION 'Anniversary recovery after February failed'; END IF;
 IF public.monthly_anniversary_date(date '2028-01-31',1,31)<>date '2028-02-29' THEN RAISE EXCEPTION 'Leap-year February clamp failed'; END IF;
END $$;

DO $test$
DECLARE b public.bookings%ROWTYPE; admin_user uuid; plan jsonb; second_plan jsonb; activated jsonb; plan_id uuid; revision_before uuid; revision_after uuid; booking_count bigint; event_count bigint; prepared1 jsonb; prepared2 jsonb; attempt uuid;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE reservation_number='ZNX-000150';
 SELECT user_id INTO admin_user FROM public.profiles WHERE is_admin ORDER BY created_at LIMIT 1;
 SELECT revision_id INTO revision_before FROM public.rental_agreement_current_revisions WHERE booking_id=b.id;
 SELECT count(*) INTO booking_count FROM public.bookings;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_user,'role','authenticated')::text,true);
 plan:=public.admin_schedule_rental_extension(b.id,date '2027-01-21',time '11:30',100000,false,'Rollback-only extension schedule test');
 plan_id:=(plan->>'plan_id')::uuid;
 IF (plan->>'period_count')::integer<>3 THEN RAISE EXCEPTION 'Expected three renewal periods'; END IF;
 IF (SELECT count(*) FROM public.rental_extension_periods WHERE extension_plan_id=plan_id)<>3 THEN RAISE EXCEPTION 'Renewal periods missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rental_extension_periods WHERE extension_plan_id=plan_id AND period_start=date '2026-10-21' AND period_end=date '2026-11-21' AND billing_reminder_date=date '2026-10-14') THEN RAISE EXCEPTION 'First period or seven-day reminder is incorrect'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rental_extension_periods WHERE extension_plan_id=plan_id AND period_number=3 AND period_start=date '2026-12-21' AND period_end=date '2027-01-21' AND billing_reminder_date=date '2026-12-14') THEN RAISE EXCEPTION 'Final anniversary period is incorrect'; END IF;
 IF EXISTS(SELECT 1 FROM public.rental_extension_periods WHERE extension_plan_id=plan_id AND communication_enabled) THEN RAISE EXCEPTION 'Communication was not disabled by default'; END IF;
 IF (SELECT end_date FROM public.bookings WHERE id=b.id)<>b.end_date THEN RAISE EXCEPTION 'Scheduling changed booking before activation'; END IF;
 IF (SELECT revision_id FROM public.rental_agreement_current_revisions WHERE booking_id=b.id)<>revision_before THEN RAISE EXCEPTION 'Scheduling changed agreement before activation'; END IF;
 activated:=public.admin_activate_rental_extension(plan_id);revision_after:=(activated->>'revision_id')::uuid;
 IF (SELECT count(*) FROM public.bookings)<>booking_count THEN RAISE EXCEPTION 'Extension created a duplicate booking'; END IF;
 IF (SELECT end_date FROM public.bookings WHERE id=b.id)<>date '2027-01-21' THEN RAISE EXCEPTION 'Activation did not update existing booking'; END IF;
 IF revision_after=revision_before OR (SELECT revision_id FROM public.rental_agreement_current_revisions WHERE booking_id=b.id)<>revision_after THEN RAISE EXCEPTION 'Current Operative Agreement was not revised'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rental_agreement_revisions WHERE id=revision_after AND previous_revision_id=revision_before AND field_changes @> '[{"field":"end_date","from":"2026-10-21","to":"2027-01-21"}]'::jsonb) THEN RAISE EXCEPTION 'Historical return dates were not preserved'; END IF;
 IF NOT (public.admin_activate_rental_extension(plan_id)->>'already_active')::boolean THEN RAISE EXCEPTION 'Activation retry was not idempotent'; END IF;
 second_plan:=public.admin_schedule_rental_extension(b.id,date '2027-02-21',time '11:30',100000,false,'Rollback-only sequential extension schedule test');
 IF (second_plan->>'period_count')::integer<>1 OR NOT EXISTS(SELECT 1 FROM public.rental_extension_periods WHERE extension_plan_id=(second_plan->>'plan_id')::uuid AND period_start=date '2027-01-21' AND period_end=date '2027-02-21' AND billing_reminder_date=date '2027-01-14') THEN RAISE EXCEPTION 'Sequential future extension schedule failed'; END IF;
 UPDATE public.bookings SET stripe_customer_id='cus_rollback_test',stripe_payment_method_id='pm_rollback_test' WHERE id=b.id;
 SELECT count(*) INTO event_count FROM public.rental_extension_events;
 prepared1:=public.admin_prepare_renewal_payment((SELECT id FROM public.rental_extension_periods WHERE extension_plan_id=plan_id AND period_number=1));
 prepared2:=public.admin_prepare_renewal_payment((SELECT id FROM public.rental_extension_periods WHERE extension_plan_id=plan_id AND period_number=1));
 attempt:=(prepared1->>'attempt_id')::uuid;
 IF attempt<>(prepared2->>'attempt_id')::uuid OR prepared1->>'idempotency_key'<>prepared2->>'idempotency_key' THEN RAISE EXCEPTION 'Payment preparation retry was not idempotent'; END IF;
 IF (SELECT count(*) FROM public.rental_renewal_payment_attempts WHERE period_id=(prepared1->>'period_id')::uuid)<>1 THEN RAISE EXCEPTION 'Duplicate payment attempt created'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('role','service_role')::text,true);
 PERFORM public.finalize_renewal_payment(attempt,'pi_rollback_test',true,NULL);
 IF NOT (public.finalize_renewal_payment(attempt,'pi_rollback_test',true,NULL)->>'already_finalized')::boolean THEN RAISE EXCEPTION 'Payment finalization retry was not idempotent'; END IF;
 IF (SELECT payment_status FROM public.rental_extension_periods WHERE id=(prepared1->>'period_id')::uuid)<>'paid' THEN RAISE EXCEPTION 'Paid status not persisted'; END IF;
 IF (SELECT count(*) FROM public.rental_extension_events WHERE period_id=(prepared1->>'period_id')::uuid AND event_type='payment_succeeded')<>1 THEN RAISE EXCEPTION 'Duplicate payment success audit'; END IF;
END $test$;

SELECT 'PASS: anniversaries, seven-day reminders, same-booking activation, immutable revision, and payment idempotency' AS result;
ROLLBACK;