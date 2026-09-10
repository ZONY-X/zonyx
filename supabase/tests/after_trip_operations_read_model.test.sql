DO $test$
DECLARE admin_id uuid; admin_user uuid; guest_id uuid; guest_user uuid; host_id uuid; host_user uuid; vehicle_id uuid; booking_id uuid; test_charge_id uuid; source_id uuid; result jsonb;
BEGIN
  SELECT id,user_id INTO admin_id,admin_user FROM profiles WHERE lower(email)='zoeysnp@gmail.com';
  SELECT id,user_id INTO guest_id,guest_user FROM profiles WHERE id<>admin_id ORDER BY created_at LIMIT 1;
  SELECT id,user_id INTO host_id,host_user FROM profiles WHERE id NOT IN(admin_id,guest_id) ORDER BY created_at LIMIT 1;
  UPDATE profiles SET is_host=true WHERE id=host_id;
  INSERT INTO vehicles(vehicle_identifier,host_profile_id,brand,name,model,year,category,color,base_daily_rate_cents,vin,plate,location,is_active) VALUES('OPS-READ',host_id,'Test','Ops','Ops',2026,'Test','Black',10000,'OPSREADVIN','OPSREAD','Miami',true) RETURNING id INTO vehicle_id;
  INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency) VALUES(guest_id,host_id,vehicle_id,'2042-01-01','2042-01-02','10:00','10:00','completed',10000,1200,800,12000,'usd') RETURNING id INTO booking_id;
  PERFORM set_config('role','service_role',true);
  INSERT INTO booking_financial_ledger(booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,status,source,external_reference,description,occurred_at,created_by_profile_id,metadata)
  VALUES(booking_id,NULL,'ops:deposit','deposit_capture','security_deposit',7500,'usd','deposit_capture','succeeded','test','pi_ops','Proven deposit capture',now(),admin_id,'{}') RETURNING id INTO source_id;
  INSERT INTO after_trip_charges(booking_id,host_profile_id,renter_profile_id,category,amount_cents,currency,explanation,status,payment_status,idempotency_key,created_by_profile_id)
  VALUES(booking_id,host_id,guest_id,'tolls',5000,'usd','Synthetic toll request','submitted','unpaid','ops-charge',host_id) RETURNING id INTO test_charge_id;
  INSERT INTO after_trip_charge_settlements(booking_id,charge_id,source_ledger_entry_id,amount_cents,currency,settlement_source,status,idempotency_key,created_by_profile_id)
  VALUES(booking_id,test_charge_id,source_id,2000,'usd','security_deposit','proven','ops-settlement',admin_id);

  PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',guest_user::text,true);
  BEGIN PERFORM get_after_trip_operations(booking_id); RAISE EXCEPTION 'Guest operations read allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest operations read allowed%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub',host_user::text,true);
  BEGIN PERFORM get_after_trip_operations(booking_id); RAISE EXCEPTION 'Host operations read allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Host operations read allowed%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
  result:=get_after_trip_operations(booking_id);
  IF NOT (result->>'read_only')::boolean THEN RAISE EXCEPTION 'Read model not marked read-only.'; END IF;
  IF (result#>>'{charges,0,settled_amount_cents}')::integer<>2000 OR (result#>>'{charges,0,remaining_amount_cents}')::integer<>3000 OR result#>>'{charges,0,settlement_status}'<>'partially_paid' THEN RAISE EXCEPTION 'Charge queue truth failed: %',result->'charges'; END IF;
  IF result#>>'{charges,0,trip_status}'<>'completed' THEN RAISE EXCEPTION 'Trip lifecycle context missing from operations read model.'; END IF;
  IF (result#>>'{settlement_sources,0,amount_cents}')::integer<>7500 OR (result#>>'{settlement_sources,0,allocated_cents}')::integer<>2000 OR (result#>>'{settlement_sources,0,available_cents}')::integer<>5500 THEN RAISE EXCEPTION 'Source availability failed: %',result->'settlement_sources'; END IF;
  IF (SELECT count(*) FROM after_trip_charges WHERE id=test_charge_id)<>1 OR (SELECT count(*) FROM after_trip_charge_settlements WHERE charge_id=test_charge_id)<>1 THEN RAISE EXCEPTION 'Read operation mutated data.'; END IF;
  RAISE NOTICE 'PASS: Admin operations read model is scoped, non-mutating, and reports canonical remaining funds';
END $test$;