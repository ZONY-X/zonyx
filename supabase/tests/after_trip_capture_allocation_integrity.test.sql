-- Run after 20260928120000. The validation runner supplies BEGIN/ROLLBACK.
DO $test$
DECLARE admin_profile uuid; admin_user uuid; guest uuid; host uuid; vehicle uuid; booking uuid:='28120000-0000-4000-8000-000000000001'; charge_one uuid:='28120000-0000-4000-8000-000000000002'; charge_two uuid:='28120000-0000-4000-8000-000000000003'; attempt uuid:='28120000-0000-4000-8000-000000000004'; preview jsonb; finalized jsonb; retry jsonb; ledger uuid;
BEGIN
 SELECT p.id,p.user_id INTO admin_profile,admin_user FROM public.profiles p WHERE p.is_admin ORDER BY p.created_at LIMIT 1;
 SELECT p.id INTO guest FROM public.profiles p WHERE p.id<>admin_profile ORDER BY p.created_at LIMIT 1;
 SELECT v.host_profile_id,v.id INTO host,vehicle FROM public.vehicles v ORDER BY v.created_at LIMIT 1;
 IF admin_profile IS NULL OR admin_user IS NULL OR guest IS NULL OR host IS NULL OR vehicle IS NULL THEN RAISE EXCEPTION 'Required fixtures unavailable.'; END IF;
 INSERT INTO public.bookings(id,reservation_number,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,currency,authorization_hold_payment_intent_id,authorization_hold_amount_cents,authorization_hold_status)
 VALUES(booking,'CAPTURE-INTEGRITY-ROLLBACK',guest,host,vehicle,'2042-01-01','2042-01-02','10:00','10:00','completed','usd','pi_capture_integrity',50000,'requires_capture');
 INSERT INTO public.after_trip_charges(id,booking_id,host_profile_id,renter_profile_id,category,amount_cents,currency,explanation,status,payment_status,idempotency_key,created_by_profile_id)
 VALUES(charge_one,booking,host,guest,'charging_energy',5000,'usd','Documented charging cost','submitted','unpaid','capture-integrity-1',host),(charge_two,booking,host,guest,'tolls',3000,'usd','Documented toll charges','submitted','unpaid','capture-integrity-2',host);
 INSERT INTO public.booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
 VALUES(booking,NULL,'after-trip-charge:'||charge_one,'after_trip_charge','charging_energy',5000,'usd','trip_debit','submitted','test',charge_one::text,'Documented charging cost',now(),host,'{}'),(booking,NULL,'after-trip-charge:'||charge_two,'after_trip_charge','tolls',3000,'usd','trip_debit','submitted','test',charge_two::text,'Documented toll charges',now(),host,'{}');

 PERFORM set_config('request.jwt.claim.sub',admin_user::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated;
 preview:=public.prepare_after_trip_deposit_capture(attempt,booking,jsonb_build_array(jsonb_build_object('charge_id',charge_one,'amount_cents',5000),jsonb_build_object('charge_id',charge_two,'amount_cents',1500)));
 RESET ROLE;
 IF (preview->>'total_cents')::bigint<>6500 THEN RAISE EXCEPTION 'Server-derived itemized total is incorrect.'; END IF;

 PERFORM set_config('request.jwt.claim.role','service_role',true); SET LOCAL ROLE service_role;
 finalized:=public.finalize_after_trip_deposit_capture(attempt,'pi_capture_integrity',6500,'ch_capture_integrity',now());
 retry:=public.finalize_after_trip_deposit_capture(attempt,'pi_capture_integrity',6500,'ch_capture_integrity',now());
 RESET ROLE;
 IF (finalized->>'already_finalized')::boolean OR NOT (retry->>'already_finalized')::boolean THEN RAISE EXCEPTION 'Finalization idempotency state failed.'; END IF;
 SELECT id INTO ledger FROM public.booking_financial_ledger WHERE booking_id=booking AND stable_key='deposit-capture:pi_capture_integrity';
 IF ledger IS NULL OR (SELECT count(*) FROM public.booking_financial_ledger WHERE booking_id=booking AND stable_key='deposit-capture:pi_capture_integrity')<>1 THEN RAISE EXCEPTION 'Capture ledger evidence duplicated or missing.'; END IF;
 IF (SELECT count(*) FROM public.after_trip_charge_settlements WHERE booking_id=booking)<>2 OR (SELECT sum(amount_cents) FROM public.after_trip_charge_settlements WHERE booking_id=booking)<>6500 THEN RAISE EXCEPTION 'Automatic settlement allocations are incorrect.'; END IF;
 IF (SELECT count(*) FROM public.after_trip_reconciliations WHERE booking_id=booking)<>1 THEN RAISE EXCEPTION 'Capture reconciliation duplicated or missing.'; END IF;
 IF (SELECT status FROM public.after_trip_charges WHERE id=charge_one)<>'paid' OR (SELECT status FROM public.after_trip_charges WHERE id=charge_two)<>'pending_payment' THEN RAISE EXCEPTION 'Full/partial charge statuses are incorrect.'; END IF;
 IF (SELECT amount_cents-COALESCE((SELECT sum(amount_cents) FROM public.after_trip_charge_settlements WHERE charge_id=charge_two),0) FROM public.after_trip_charges WHERE id=charge_two)<>1500 THEN RAISE EXCEPTION 'Partial allocation remainder is incorrect.'; END IF;
 PERFORM set_config('request.jwt.claim.sub',admin_user::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_after_trip_operations(booking)->'unreconciled_sources') x WHERE x->>'ledger_entry_id'=ledger::text) THEN RAISE EXCEPTION 'Fully allocated capture appeared as unreconciled.'; END IF;
 RESET ROLE;

 PERFORM set_config('request.jwt.claim.sub',admin_user::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated;
 BEGIN
  PERFORM public.prepare_after_trip_deposit_capture(gen_random_uuid(),booking,jsonb_build_array(jsonb_build_object('charge_id',charge_two,'amount_cents',1501)));
  RAISE EXCEPTION 'Excess allocation unexpectedly succeeded.';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Excess allocation unexpectedly succeeded.' THEN RAISE; END IF; END;
 RESET ROLE;
END $test$;

DO $orphan$
DECLARE admin_profile uuid; admin_user uuid; guest uuid; host uuid; vehicle uuid; booking uuid:='28120000-0000-4000-8000-000000000011'; ledger uuid:='28120000-0000-4000-8000-000000000012'; payload jsonb;
BEGIN
 SELECT p.id,p.user_id INTO admin_profile,admin_user FROM public.profiles p WHERE p.is_admin ORDER BY p.created_at LIMIT 1;
 SELECT p.id INTO guest FROM public.profiles p WHERE p.id<>admin_profile ORDER BY p.created_at LIMIT 1;
 SELECT v.host_profile_id,v.id INTO host,vehicle FROM public.vehicles v ORDER BY v.created_at LIMIT 1;
 INSERT INTO public.bookings(id,reservation_number,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,currency)
 VALUES(booking,'ORPHAN-CAPTURE-ROLLBACK',guest,host,vehicle,'2042-02-01','2042-02-02','10:00','10:00','completed','usd');
 INSERT INTO public.booking_financial_ledger(id,booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
 VALUES(ledger,booking,NULL,'deposit-capture:pi_orphan_visibility','deposit_capture','security_deposit',7030,'usd','deposit_capture','succeeded','stripe_evidence','pi_orphan_visibility','Stripe-proven security-deposit capture',now(),admin_profile,'{}');
 PERFORM set_config('request.jwt.claim.sub',admin_user::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated;
 payload:=public.get_after_trip_operations(booking);
 RESET ROLE;
 IF payload#>>'{unreconciled_sources,0,reservation_number}'<>'ORPHAN-CAPTURE-ROLLBACK' OR (payload#>>'{unreconciled_sources,0,available_cents}')::bigint<>7030 THEN RAISE EXCEPTION 'Orphaned proven capture visibility failed.'; END IF;
END $orphan$;

SELECT 'PASS: itemized capture allocation, partial settlement, idempotency, and orphan visibility' AS result;