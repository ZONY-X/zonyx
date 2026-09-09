DO $test$
DECLARE
 admin_id uuid; admin_user uuid; guest_id uuid; guest_user uuid; other_guest_id uuid; host_id uuid; host_user uuid; other_host_id uuid; other_host_user uuid;
 vehicle_id uuid; test_booking_id uuid; booking_over uuid; recon uuid; deposit_source uuid; rental_source uuid; future_source uuid; refunded_source uuid; charge uuid; settlement uuid; retry_settlement uuid; preview jsonb; receipt jsonb; lines jsonb; audit_before integer; audit_after integer;
BEGIN
 SELECT id,user_id INTO admin_id,admin_user FROM profiles WHERE lower(email)='zoeysnp@gmail.com';
 SELECT id,user_id INTO guest_id,guest_user FROM profiles WHERE id<>admin_id ORDER BY created_at LIMIT 1;
 SELECT id INTO other_guest_id FROM profiles WHERE id NOT IN(admin_id,guest_id) ORDER BY created_at LIMIT 1;
 SELECT id,user_id INTO host_id,host_user FROM profiles WHERE id NOT IN(admin_id,guest_id,other_guest_id) ORDER BY created_at LIMIT 1;
 SELECT id,user_id INTO other_host_id,other_host_user FROM profiles WHERE id NOT IN(admin_id,guest_id,other_guest_id,host_id) ORDER BY created_at LIMIT 1;
 UPDATE profiles SET is_host=true WHERE id IN(host_id,other_host_id);
 INSERT INTO vehicles(vehicle_identifier,host_profile_id,brand,name,model,year,category,color,base_daily_rate_cents,vin,plate,location,is_active) VALUES('M4D-ONE',host_id,'Test','M4D','M4D',2026,'Test','Black',10000,'M4DVIN','M4D','Miami',true) RETURNING id INTO vehicle_id;
 INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency) VALUES(guest_id,host_id,vehicle_id,'2041-01-01','2041-01-02','10:00','10:00','completed',33000,4000,3000,40000,'usd') RETURNING id INTO test_booking_id;
 INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency) VALUES(guest_id,host_id,vehicle_id,'2041-02-01','2041-02-02','10:00','10:00','completed',33000,4000,3000,40000,'usd') RETURNING id INTO booking_over;
 PERFORM set_config('role','service_role',true);
 recon:=persist_booking_financial_reconciliation(test_booking_id,'m4d:base','Synthetic base reconciliation','2026-09-09T00:00:00Z','{}','{}',ARRAY[]::text[],admin_id,jsonb_build_array(
  jsonb_build_object('stable_key','booking:base','entry_type','booking_component','category','rental_subtotal','amount_cents',40000,'currency','usd','effect','trip_debit','status','posted','source','test','external_reference',null,'description','Trip','occurred_at','2041-01-01T00:00:00Z','metadata','{}'::jsonb),
  jsonb_build_object('stable_key','payment:rental','entry_type','payment','category','rental_payment','amount_cents',40000,'currency','usd','effect','payment','status','succeeded','source','test','external_reference','pi_rental','description','Rental payment','occurred_at','2041-01-01T00:00:00Z','metadata','{}'::jsonb),
  jsonb_build_object('stable_key','deposit-capture:pi_hold','entry_type','deposit_capture','category','security_deposit','amount_cents',9312,'currency','usd','effect','deposit_capture','status','succeeded','source','stripe_evidence','external_reference','pi_hold','description','Deposit capture','occurred_at','2041-01-02T00:00:00Z','metadata','{}'::jsonb),
  jsonb_build_object('stable_key','deposit-release:pi_hold','entry_type','deposit_release','category','security_deposit','amount_cents',65688,'currency','usd','effect','deposit_release','status','settled','source','stripe_evidence','external_reference','pi_hold','description','Release','occurred_at','2041-01-02T00:00:00Z','metadata','{}'::jsonb)
 ));
 SELECT l.id INTO deposit_source FROM booking_financial_ledger l WHERE l.booking_id=test_booking_id AND l.effect='deposit_capture';
 SELECT l.id INTO rental_source FROM booking_financial_ledger l WHERE l.booking_id=test_booking_id AND l.category='rental_payment';
 -- Avoid variable/column ambiguity in remaining queries by binding known IDs above.
 lines:=jsonb_build_array(jsonb_build_object('category','charging_energy','amount_cents',5500,'explanation','Battery difference fee'),jsonb_build_object('category','parking_tickets_violations','amount_cents',1800,'explanation','Parking tickets'),jsonb_build_object('category','tolls','amount_cents',517,'explanation','Toll statement'),jsonb_build_object('category','administrative_fee','amount_cents',1495,'explanation','Administrative processing fee'));
 PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',guest_user::text,true);
 BEGIN PERFORM prepare_historical_after_trip_reconciliation(test_booking_id,lines,deposit_source); RAISE EXCEPTION 'Guest prepare allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest prepare allowed%' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub',host_user::text,true);
 BEGIN PERFORM confirm_historical_after_trip_reconciliation(test_booking_id,lines,deposit_source,'Host attempt','host-attempt','x'); RAISE EXCEPTION 'Host confirm allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Host confirm allowed%' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
 BEGIN PERFORM prepare_historical_after_trip_reconciliation(test_booking_id,lines,rental_source); RAISE EXCEPTION 'Rental payment reused.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Rental payment reused%' THEN RAISE; END IF; END;
 preview:=prepare_historical_after_trip_reconciliation(test_booking_id,lines,deposit_source);
 IF (preview->>'total_charge_cents')::integer<>9312 OR (preview->>'proposed_settlement_cents')::integer<>9312 OR (preview->>'additional_balance_due_cents')::integer<>0 OR (preview->>'writes_performed')::boolean THEN RAISE EXCEPTION '93.12 preview failed: %',preview; END IF;
 audit_before:=(SELECT count(*) FROM booking_audit_events a WHERE a.booking_id=test_booking_id);
 recon:=confirm_historical_after_trip_reconciliation(test_booking_id,lines,deposit_source,'Historical documented charge settlement','m4d:historical:one',preview->>'proposal_fingerprint');
 IF recon<>confirm_historical_after_trip_reconciliation(test_booking_id,lines,deposit_source,'Historical documented charge settlement','m4d:historical:one',preview->>'proposal_fingerprint') THEN RAISE EXCEPTION 'Historical idempotency failed.'; END IF;
 audit_after:=(SELECT count(*) FROM booking_audit_events a WHERE a.booking_id=test_booking_id);
 IF audit_after-audit_before<>5 THEN RAISE EXCEPTION 'Expected four line audits plus reconciliation audit.'; END IF;
 receipt:=get_final_trip_receipt(test_booking_id);
 IF (receipt#>>'{financial,base_trip_total_cents}')::integer<>40000 OR (receipt#>>'{financial,after_trip_charges_cents}')::integer<>9312 OR (receipt#>>'{financial,after_trip_settled_from_deposit_cents}')::integer<>9312 OR (receipt#>>'{financial,after_trip_outstanding_cents}')::integer<>0 OR (receipt#>>'{financial,balance_cents}')::integer<>0 THEN RAISE EXCEPTION '93.12 receipt failed: %',receipt->'financial'; END IF;
 IF (receipt#>>'{financial,amount_paid_cents}')::integer<>40000 THEN RAISE EXCEPTION 'Deposit was double-counted as rental payment.'; END IF;
 IF jsonb_array_length(receipt->'after_trip_charges')<>4 THEN RAISE EXCEPTION 'Historical charge lines missing.'; END IF;

 -- New ordinary Host request remains unpaid until proven evidence allocation.
 PERFORM set_config('request.jwt.claim.sub',host_user::text,true);
 charge:=submit_after_trip_charge(test_booking_id,'cleaning',5000,'Synthetic cleaning request',ARRAY[]::uuid[],'m4d-future-charge');
 receipt:=get_final_trip_receipt(test_booking_id);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'after_trip_charges') x WHERE x->>'id'=charge::text AND x->>'settlement_status'='unpaid') THEN RAISE EXCEPTION 'Submitted charge falsely settled.'; END IF;
 PERFORM set_config('request.jwt.claim.sub',other_host_user::text,true);
 BEGIN PERFORM admin_allocate_after_trip_settlement(charge,deposit_source,5000,'Cross Host attempt','m4d-cross-host'); RAISE EXCEPTION 'Host allocation allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Host allocation allowed%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub',guest_user::text,true);
  BEGIN PERFORM admin_allocate_after_trip_settlement(charge,deposit_source,5000,'Guest allocation attempt','m4d-guest-allocation'); RAISE EXCEPTION 'Guest allocation allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest allocation allowed%' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
 -- Existing 93.12 source is fully allocated; over-allocation must fail.
 BEGIN PERFORM admin_allocate_after_trip_settlement(charge,deposit_source,5000,'No source balance','m4d-no-balance'); RAISE EXCEPTION 'Source over-allocation allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Source over-allocation allowed%' THEN RAISE; END IF; END;
  -- Add separate proven deposit evidence to model a future $50 capture without moving money.
  PERFORM set_config('role','service_role',true);
  INSERT INTO booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
  VALUES(test_booking_id,NULL,'deposit-capture:pi_future','deposit_capture','security_deposit',5000,'usd','deposit_capture','succeeded','synthetic_proven_evidence','pi_future','Future proven deposit capture',now(),admin_id,'{}') RETURNING id INTO future_source;
  INSERT INTO booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
  VALUES(test_booking_id,NULL,'deposit-capture:pi_refunded','deposit_capture','security_deposit',5000,'usd','deposit_capture','succeeded','synthetic_proven_evidence','pi_refunded','Refunded source capture',now(),admin_id,'{}') RETURNING id INTO refunded_source;
  INSERT INTO booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
  VALUES(test_booking_id,NULL,'deposit-refund:pi_refunded','deposit_refund','security_deposit',5000,'usd','deposit_refund','succeeded','synthetic_proven_evidence','pi_refunded','Refunded source funds',now(),admin_id,'{}');
  PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
  BEGIN PERFORM admin_allocate_after_trip_settlement(charge,refunded_source,5000,'Refunded source attempt','m4d-refunded-source'); RAISE EXCEPTION 'Refunded source allocated.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Refunded source allocated%' THEN RAISE; END IF; END;
  settlement:=admin_allocate_after_trip_settlement(charge,future_source,5000,'Existing proven future deposit capture','m4d-future-settlement');
  retry_settlement:=admin_allocate_after_trip_settlement(charge,future_source,5000,'Existing proven future deposit capture','m4d-future-settlement');
  IF settlement<>retry_settlement THEN RAISE EXCEPTION 'Future settlement idempotency failed.'; END IF;
  receipt:=get_final_trip_receipt(test_booking_id);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'after_trip_charges') x WHERE x->>'id'=charge::text AND x->>'settlement_status'='paid' AND (x->>'settled_amount_cents')::integer=5000) THEN RAISE EXCEPTION 'Future $50 deposit settlement failed.'; END IF;

 -- $900 charge set against $750 proven deposit leaves $150 due on separate synthetic booking.
 PERFORM set_config('role','service_role',true);
 recon:=persist_booking_financial_reconciliation(booking_over,'m4d:over-base','Synthetic overage reconciliation','2026-09-09T00:00:00Z','{}','{}',ARRAY[]::text[],admin_id,jsonb_build_array(
  jsonb_build_object('stable_key','booking:base','entry_type','booking_component','category','rental_subtotal','amount_cents',40000,'currency','usd','effect','trip_debit','status','posted','source','test','external_reference',null,'description','Trip','occurred_at','2041-02-01T00:00:00Z','metadata','{}'::jsonb),
  jsonb_build_object('stable_key','payment:rental','entry_type','payment','category','rental_payment','amount_cents',40000,'currency','usd','effect','payment','status','succeeded','source','test','external_reference','pi_rental_over','description','Rental payment','occurred_at','2041-02-01T00:00:00Z','metadata','{}'::jsonb),
  jsonb_build_object('stable_key','deposit-capture:pi_over','entry_type','deposit_capture','category','security_deposit','amount_cents',75000,'currency','usd','effect','deposit_capture','status','succeeded','source','stripe_evidence','external_reference','pi_over','description','Deposit capture','occurred_at','2041-02-02T00:00:00Z','metadata','{}'::jsonb)
 ));
 SELECT id INTO deposit_source FROM booking_financial_ledger l WHERE l.booking_id=booking_over AND l.effect='deposit_capture';
 PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
 lines:=jsonb_build_array(jsonb_build_object('category','damage','amount_cents',90000,'explanation','Synthetic documented damage'));
 preview:=prepare_historical_after_trip_reconciliation(booking_over,lines,deposit_source);
 IF (preview->>'proposed_settlement_cents')::integer<>75000 OR (preview->>'additional_balance_due_cents')::integer<>15000 THEN RAISE EXCEPTION '900/750 preview failed.'; END IF;
 PERFORM confirm_historical_after_trip_reconciliation(booking_over,lines,deposit_source,'Synthetic partial settlement','m4d:over:one',preview->>'proposal_fingerprint');
 receipt:=get_final_trip_receipt(booking_over);
 IF (receipt#>>'{financial,after_trip_charges_cents}')::integer<>90000 OR (receipt#>>'{financial,after_trip_settled_from_deposit_cents}')::integer<>75000 OR (receipt#>>'{financial,after_trip_outstanding_cents}')::integer<>15000 OR (receipt#>>'{financial,balance_cents}')::integer<>15000 THEN RAISE EXCEPTION '900/750 receipt failed: %',receipt->'financial'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'after_trip_charges') x WHERE x->>'settlement_status'='partially_paid') THEN RAISE EXCEPTION 'Partial settlement status missing.'; END IF;
 RAISE NOTICE 'PASS: Module 4D historical/future settlement, ownership, idempotency, deposit separation and receipt arithmetic';
END $test$;