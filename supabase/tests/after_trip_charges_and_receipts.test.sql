DO $test$
DECLARE
  admin_id uuid; admin_user uuid; guest_id uuid; guest_user uuid; other_guest_id uuid; other_guest_user uuid;
  host_id uuid; host_user uuid; other_host_id uuid; other_host_user uuid; vehicle_id uuid; other_vehicle_id uuid;
  test_booking_id uuid; other_booking_id uuid; active_booking_id uuid; unreconciled_booking_id uuid; reconciliation_id uuid; charge_id uuid; retry_id uuid; evidence_id uuid; other_evidence_id uuid;
  receipt jsonb; audit_count integer; ledger_count integer;
BEGIN
  SELECT id,user_id INTO admin_id,admin_user FROM profiles WHERE lower(email)='zoeysnp@gmail.com';
  SELECT id,user_id INTO guest_id,guest_user FROM profiles WHERE id<>admin_id ORDER BY created_at LIMIT 1;
  SELECT id,user_id INTO other_guest_id,other_guest_user FROM profiles WHERE id NOT IN(admin_id,guest_id) ORDER BY created_at LIMIT 1;
  SELECT id,user_id INTO host_id,host_user FROM profiles WHERE id NOT IN(admin_id,guest_id,other_guest_id) ORDER BY created_at LIMIT 1;
  SELECT id,user_id INTO other_host_id,other_host_user FROM profiles WHERE id NOT IN(admin_id,guest_id,other_guest_id,host_id) ORDER BY created_at LIMIT 1;
  IF other_host_id IS NULL THEN RAISE EXCEPTION 'Required profile fixtures unavailable.'; END IF;
  UPDATE profiles SET is_host=true WHERE id IN(host_id,other_host_id);
  INSERT INTO vehicles(vehicle_identifier,host_profile_id,brand,name,model,year,category,color,base_daily_rate_cents,vin,plate,location,is_active) VALUES('M4C-ONE',host_id,'Test','M4C One','M4C One',2026,'Test','Black',10000,'M4CONEVIN','M4C1','Miami Beach',true) RETURNING id INTO vehicle_id;
  INSERT INTO vehicles(vehicle_identifier,host_profile_id,brand,name,model,year,category,color,base_daily_rate_cents,vin,plate,location,is_active) VALUES('M4C-TWO',other_host_id,'Test','M4C Two','M4C Two',2026,'Test','Black',10000,'M4CTWOVIN','M4C2','Miami Beach',true) RETURNING id INTO other_vehicle_id;
  INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,authorization_hold_amount_cents) VALUES(guest_id,host_id,vehicle_id,'2040-01-01','2040-01-02','10:00','10:00','Miami Airport','Miami Airport','airport_delivery','completed',33000,4000,3000,40000,'usd',75000) RETURNING id INTO test_booking_id;
  INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,authorization_hold_amount_cents) VALUES(other_guest_id,other_host_id,other_vehicle_id,'2040-02-01','2040-02-02','10:00','10:00','completed',10000,1200,800,12000,'usd',0) RETURNING id INTO other_booking_id;
  INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,authorization_hold_amount_cents) VALUES(guest_id,host_id,vehicle_id,'2040-03-01','2040-03-02','10:00','10:00','active',10000,1200,800,12000,'usd',0) RETURNING id INTO active_booking_id;
  INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,authorization_hold_amount_cents) VALUES(guest_id,host_id,vehicle_id,'2040-04-01','2040-04-02','10:00','10:00','completed',10000,1200,800,12000,'usd',0) RETURNING id INTO unreconciled_booking_id;
  INSERT INTO rental_images(booking_id,uploaded_by_profile_id,image_type,image_url,notes) VALUES(test_booking_id,host_id,'after','synthetic/path.jpg','Synthetic evidence') RETURNING id INTO evidence_id;
  INSERT INTO rental_images(booking_id,uploaded_by_profile_id,image_type,image_url,notes) VALUES(other_booking_id,other_host_id,'after','synthetic/other.jpg','Other booking evidence') RETURNING id INTO other_evidence_id;

  PERFORM set_config('role','service_role',true);
  reconciliation_id:=persist_booking_financial_reconciliation(test_booking_id,'m4c:base','Synthetic base reconciliation','2026-09-09T00:00:00Z','{}','{}',ARRAY[]::text[],admin_id,jsonb_build_array(
    jsonb_build_object('stable_key','booking:rental_subtotal','entry_type','booking_component','category','rental_subtotal','amount_cents',33000,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Rental','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','booking:service_fee','entry_type','booking_component','category','service_fee','amount_cents',4000,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Service fee','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','booking:taxes','entry_type','booking_component','category','taxes','amount_cents',3000,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Taxes','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','payment:pi_base','entry_type','payment','category','rental_payment','amount_cents',40000,'currency','usd','effect','payment','status','succeeded','source','stripe_payment_intent','external_reference','pi_base','description','Payment','occurred_at','2026-08-01T01:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','deposit-authorization:pi_hold','entry_type','deposit_authorization','category','security_deposit','amount_cents',75000,'currency','usd','effect','authorization','status','succeeded','source','stripe_payment_intent','external_reference','pi_hold','description','Authorization','occurred_at','2026-08-01T01:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','deposit-capture:pi_hold','entry_type','deposit_capture','category','security_deposit','amount_cents',9312,'currency','usd','effect','deposit_capture','status','succeeded','source','stripe_evidence','external_reference','pi_hold','description','Capture','occurred_at','2026-08-01T02:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','deposit-release:pi_hold','entry_type','deposit_release','category','security_deposit','amount_cents',65688,'currency','usd','effect','deposit_release','status','settled','source','stripe_evidence','external_reference','pi_hold','description','Release','occurred_at','2026-08-01T02:00:00Z','metadata','{}'::jsonb)
  ));

  PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',guest_user::text,true);
  BEGIN PERFORM submit_after_trip_charge(test_booking_id,'tolls',5000,'Guest attempt',ARRAY[evidence_id],'guest-attempt'); RAISE EXCEPTION 'Guest submission allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest submission allowed%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub',other_host_user::text,true);
  BEGIN PERFORM submit_after_trip_charge(test_booking_id,'tolls',5000,'Cross host attempt',ARRAY[evidence_id],'cross-host'); RAISE EXCEPTION 'Cross-host submission allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Cross-host submission allowed%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub',host_user::text,true);
  BEGIN PERFORM submit_after_trip_charge(active_booking_id,'tolls',5000,'Wrong lifecycle',ARRAY[]::uuid[],'wrong-state'); RAISE EXCEPTION 'Active-trip charge allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Active-trip charge allowed%' THEN RAISE; END IF; END;
  BEGIN PERFORM submit_after_trip_charge(unreconciled_booking_id,'tolls',5000,'Unreconciled attempt',ARRAY[]::uuid[],'no-reconciliation'); RAISE EXCEPTION 'Unreconciled charge allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Unreconciled charge allowed%' THEN RAISE; END IF; END;
  BEGIN PERFORM get_final_trip_receipt(unreconciled_booking_id); RAISE EXCEPTION 'Unreconciled receipt allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Unreconciled receipt allowed%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM submit_after_trip_charge(test_booking_id,'tolls',5000,'Wrong booking evidence',ARRAY[other_evidence_id],'wrong-evidence');
    RAISE EXCEPTION 'Cross-booking evidence allowed.';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Cross-booking evidence allowed%' THEN RAISE; END IF; END;
  charge_id:=submit_after_trip_charge(test_booking_id,'tolls',5000,'Synthetic toll invoice',ARRAY[evidence_id],'m4c-charge-one');
  retry_id:=submit_after_trip_charge(test_booking_id,'tolls',5000,'Synthetic toll invoice',ARRAY[evidence_id],'m4c-charge-one');
  IF charge_id<>retry_id THEN RAISE EXCEPTION 'Charge idempotency failed.'; END IF;
  IF EXISTS(SELECT 1 FROM booking_financial_ledger WHERE booking_id=test_booking_id) THEN RAISE EXCEPTION 'Host raw ledger read unexpectedly allowed.'; END IF;
  PERFORM set_config('role','service_role',true);
  SELECT count(*) INTO ledger_count FROM booking_financial_ledger WHERE booking_id=test_booking_id AND stable_key='after-trip-charge:'||charge_id;
  IF ledger_count<>1 THEN RAISE EXCEPTION 'Duplicate charge ledger entry.'; END IF;
  PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',host_user::text,true);
  receipt:=get_final_trip_receipt(test_booking_id);
  IF (receipt#>>'{financial,final_trip_total_cents}')::integer<>45000 OR (receipt#>>'{financial,amount_paid_cents}')::integer<>40000 OR (receipt#>>'{financial,balance_cents}')::integer<>5000 THEN RAISE EXCEPTION 'Unpaid charge arithmetic failed: %',receipt->'financial'; END IF;
  IF (receipt#>>'{financial,deposit_authorized_cents}')::integer<>75000 OR (receipt#>>'{financial,deposit_captured_cents}')::integer<>9312 OR (receipt#>>'{financial,deposit_released_cents}')::integer<>65688 THEN RAISE EXCEPTION 'Deposit separation failed.'; END IF;
  IF (SELECT payment_status FROM after_trip_charges WHERE id=charge_id)<>'unpaid' OR (SELECT status FROM after_trip_charges WHERE id=charge_id)<>'submitted' THEN RAISE EXCEPTION 'Submission falsely marked paid.'; END IF;
  IF jsonb_array_length(receipt->'after_trip_charges')<>1 OR jsonb_array_length(receipt#>'{after_trip_charges,0,evidence}')<>1 THEN RAISE EXCEPTION 'Receipt charge/evidence missing.'; END IF;
  IF EXISTS(SELECT 1 FROM after_trip_charges WHERE booking_id=other_booking_id) THEN RAISE EXCEPTION 'Cross booking charge created.'; END IF;

  PERFORM set_config('request.jwt.claim.sub',other_guest_user::text,true);
  BEGIN PERFORM get_final_trip_receipt(test_booking_id); RAISE EXCEPTION 'Other guest receipt allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Other guest receipt allowed%' THEN RAISE; END IF; END;
  IF EXISTS(SELECT 1 FROM after_trip_charges WHERE id=charge_id) THEN RAISE EXCEPTION 'Other guest read charge.'; END IF;
  PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
  IF NOT EXISTS(SELECT 1 FROM after_trip_charges WHERE id=charge_id) THEN RAISE EXCEPTION 'Admin cannot inspect charge.'; END IF;
  PERFORM admin_set_after_trip_charge_status(charge_id,'disputed','Synthetic dispute review');
  PERFORM admin_set_after_trip_charge_status(charge_id,'disputed','Idempotent retry');
  PERFORM admin_set_after_trip_charge_status(charge_id,'waived','Synthetic waiver decision');
  receipt:=get_final_trip_receipt(test_booking_id);
  IF (receipt#>>'{financial,final_trip_total_cents}')::integer<>40000 OR (receipt#>>'{financial,balance_cents}')::integer<>0 THEN RAISE EXCEPTION 'Waiver reversal failed.'; END IF;
  BEGIN PERFORM admin_set_after_trip_charge_status(charge_id,'paid','Fake payment'); RAISE EXCEPTION 'Admin fake-paid allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Admin fake-paid allowed%' THEN RAISE; END IF; END;
  SELECT count(*) INTO audit_count FROM booking_audit_events WHERE booking_id=test_booking_id AND action_type IN('after_trip_charge_submitted','after_trip_charge_status_changed');
  IF audit_count<>3 THEN RAISE EXCEPTION 'Expected 3 audit events, got %.',audit_count; END IF;

  -- Test a second charge; immutable first charge/waiver history remains intact.
  PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',host_user::text,true);
  charge_id:=submit_after_trip_charge(test_booking_id,'charging_energy',5000,'Synthetic charging invoice',ARRAY[]::uuid[],'m4c-charge-two');
  -- Separate synthetic proven payment evidence explicitly references that charge.
  PERFORM set_config('role','service_role',true);
  INSERT INTO booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
  VALUES(test_booking_id,NULL,'payment:pi_after_trip','payment','after_trip_payment',5000,'usd','payment','succeeded','synthetic_proven_payment','pi_after_trip','Synthetic proven after-trip payment',now(),admin_id,jsonb_build_object('after_trip_charge_id',charge_id));
  PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',host_user::text,true);
  receipt:=get_final_trip_receipt(test_booking_id);
  IF (receipt#>>'{financial,final_trip_total_cents}')::integer<>45000 OR (receipt#>>'{financial,amount_paid_cents}')::integer<>45000 OR (receipt#>>'{financial,balance_cents}')::integer<>0 THEN RAISE EXCEPTION 'Proven after-trip payment arithmetic failed: %',receipt->'financial'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'after_trip_charges') c WHERE c->>'id'=charge_id::text AND c->>'payment_status'='paid') THEN RAISE EXCEPTION 'Explicit charge payment association missing.'; END IF;
  RAISE NOTICE 'PASS: Module 4C ownership, unpaid submission, ledger arithmetic, deposit separation, receipt privacy, evidence, Admin resolution and payment-proof tests';
END $test$;