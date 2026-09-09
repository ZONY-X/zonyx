DO $test$
DECLARE
  admin_id uuid; admin_user uuid; guest_id uuid; guest_user uuid; host_id uuid; host_user uuid;
  other_guest_id uuid; other_guest_user uuid; vehicle_id uuid; reconciled_booking_id uuid; plain_booking_id uuid;
  reconciliation_id uuid; admin_row record; guest_row record; host_row record; plain_row record; original_total integer; audit_count integer;
BEGIN
  SELECT id,user_id INTO admin_id,admin_user FROM public.profiles WHERE lower(email)='zoeysnp@gmail.com';
  SELECT id,user_id INTO guest_id,guest_user FROM public.profiles WHERE id<>admin_id ORDER BY created_at LIMIT 1;
  SELECT id,user_id INTO host_id,host_user FROM public.profiles WHERE id NOT IN(admin_id,guest_id) ORDER BY created_at LIMIT 1;
  SELECT id,user_id INTO other_guest_id,other_guest_user FROM public.profiles WHERE id NOT IN(admin_id,guest_id,host_id) ORDER BY created_at LIMIT 1;
  IF other_guest_id IS NULL THEN RAISE EXCEPTION 'Required profile fixtures unavailable.'; END IF;
  UPDATE public.profiles SET is_host=true WHERE id=host_id;
  INSERT INTO public.vehicles(vehicle_identifier,host_profile_id,brand,name,model,year,category,color,base_daily_rate_cents,vin,plate,location,is_active)
  VALUES('M4B1-SYNTHETIC',host_id,'Test','M4B1','M4B1',2026,'Test','Black',10000,'M4B1VIN','M4B1','Miami Beach',true) RETURNING id INTO vehicle_id;
  INSERT INTO public.bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,authorization_hold_amount_cents)
  VALUES(guest_id,host_id,vehicle_id,'2039-01-01','2039-01-02','10:00','10:00','Coconut Grove','Coconut Grove','completed',24900,2988,1992,29880,'usd',75000) RETURNING id,grand_total_cents INTO reconciled_booking_id,original_total;
  INSERT INTO public.bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,authorization_hold_amount_cents)
  VALUES(other_guest_id,host_id,vehicle_id,'2039-02-01','2039-02-02','10:00','10:00','Miami Beach','Miami Beach','confirmed',10000,1200,800,12000,'usd',0) RETURNING id INTO plain_booking_id;

  PERFORM set_config('role','service_role',true);
  reconciliation_id:=public.persist_booking_financial_reconciliation(reconciled_booking_id,'m4b1:test','Synthetic reconciliation','2026-09-09T00:00:00Z','{}','{}',ARRAY[]::text[],admin_id,jsonb_build_array(
    jsonb_build_object('stable_key','booking:rental_subtotal','entry_type','booking_component','category','rental_subtotal','amount_cents',24900,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Rental subtotal','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','booking:service_fee','entry_type','booking_component','category','service_fee','amount_cents',2988,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Service fee','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','booking:taxes','entry_type','booking_component','category','taxes','amount_cents',1992,'currency','usd','effect','trip_debit','status','posted','source','zonyx_historical_snapshot','external_reference',null,'description','Taxes','occurred_at','2026-08-01T00:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','adjustment:cs_test','entry_type','adjustment','category','historical_stripe_total_correction','amount_cents',10120,'currency','usd','effect','trip_debit','status','posted','source','stripe_checkout','external_reference','cs_test','description','Correction','occurred_at','2026-08-01T01:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','payment:pi_test','entry_type','payment','category','rental_payment','amount_cents',40000,'currency','usd','effect','payment','status','succeeded','source','stripe_payment_intent','external_reference','pi_test','description','Payment','occurred_at','2026-08-01T01:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','deposit-authorization:pi_hold','entry_type','deposit_authorization','category','security_deposit','amount_cents',75000,'currency','usd','effect','authorization','status','succeeded','source','stripe_payment_intent','external_reference','pi_hold','description','Authorization','occurred_at','2026-08-01T01:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','deposit-capture:pi_hold','entry_type','deposit_capture','category','security_deposit','amount_cents',9312,'currency','usd','effect','deposit_capture','status','succeeded','source','stripe_evidence','external_reference','pi_hold','description','Capture','occurred_at','2026-08-01T02:00:00Z','metadata','{}'::jsonb),
    jsonb_build_object('stable_key','deposit-release:pi_hold','entry_type','deposit_release','category','security_deposit','amount_cents',65688,'currency','usd','effect','deposit_release','status','settled','source','stripe_evidence','external_reference','pi_hold','description','Release','occurred_at','2026-08-01T02:00:00Z','metadata','{}'::jsonb)
  ));

  PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
  SELECT * INTO admin_row FROM public.get_booking_operational_read_model() WHERE id=reconciled_booking_id;
  SELECT * INTO plain_row FROM public.get_booking_operational_read_model() WHERE id=plain_booking_id;
  IF admin_row.displayed_total_cents<>40000 OR admin_row.original_booking_total_cents<>29880 OR NOT admin_row.is_financially_reconciled THEN RAISE EXCEPTION 'Reconciled display precedence failed.'; END IF;
  IF plain_row.displayed_total_cents<>12000 OR plain_row.is_financially_reconciled THEN RAISE EXCEPTION 'Unreconciled fallback failed.'; END IF;
  IF NOT admin_row.deposit_settled OR admin_row.deposit_captured_cents<>9312 OR admin_row.deposit_released_cents<>65688 THEN RAISE EXCEPTION 'Deposit read model failed.'; END IF;

  PERFORM set_config('request.jwt.claim.sub',guest_user::text,true); SELECT * INTO guest_row FROM public.get_booking_operational_read_model() WHERE id=reconciled_booking_id;
  IF guest_row.id IS NULL OR guest_row.displayed_total_cents<>admin_row.displayed_total_cents OR guest_row.start_date<>admin_row.start_date OR guest_row.pickup_location<>admin_row.pickup_location THEN RAISE EXCEPTION 'Guest/Admin read models disagree.'; END IF;
  IF EXISTS(SELECT 1 FROM public.get_booking_operational_read_model() WHERE id=plain_booking_id) THEN RAISE EXCEPTION 'Guest read another Guest booking.'; END IF;
  BEGIN PERFORM public.admin_correct_historical_trip_details(reconciled_booking_id,'2039-01-03','11:00','2039-01-04','12:00','Airport Terminal','Airport Terminal','airport_delivery','Guest attempt'); RAISE EXCEPTION 'Guest correction allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest correction allowed%' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claim.sub',host_user::text,true); SELECT * INTO host_row FROM public.get_booking_operational_read_model() WHERE id=reconciled_booking_id;
  IF host_row.id IS NULL OR host_row.displayed_total_cents<>admin_row.displayed_total_cents OR host_row.start_date<>admin_row.start_date OR host_row.pickup_location<>admin_row.pickup_location THEN RAISE EXCEPTION 'Host/Admin read models disagree.'; END IF;
  BEGIN PERFORM public.admin_correct_historical_trip_details(reconciled_booking_id,'2039-01-03','11:00','2039-01-04','12:00','Airport Terminal','Airport Terminal','airport_delivery','Host attempt'); RAISE EXCEPTION 'Host correction allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Host correction allowed%' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
  PERFORM public.admin_correct_historical_trip_details(reconciled_booking_id,'2039-01-03','11:00','2039-01-04','12:00','Miami International Airport','Miami International Airport','airport_delivery','Historical airport delivery evidence');
  SELECT * INTO admin_row FROM public.get_booking_operational_read_model() WHERE id=reconciled_booking_id;
  IF admin_row.start_date<>'2039-01-03' OR admin_row.pickup_time<>'11:00' OR admin_row.end_date<>'2039-01-04' OR admin_row.dropoff_time<>'12:00' OR admin_row.pickup_location<>'Miami International Airport' OR admin_row.dropoff_location<>'Miami International Airport' OR admin_row.fulfillment_method<>'airport_delivery' THEN RAISE EXCEPTION 'Corrected operational truth missing.'; END IF;
  IF admin_row.displayed_total_cents<>40000 OR (SELECT grand_total_cents FROM bookings WHERE id=reconciled_booking_id)<>original_total OR admin_row.trip_status<>'completed' THEN RAISE EXCEPTION 'Correction changed finance/lifecycle.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM booking_audit_events WHERE booking_id=reconciled_booking_id AND action_type='historical_trip_details_correction' AND before_state->>'pickup_location'='Coconut Grove' AND after_state->>'fulfillment_method'='airport_delivery' AND before_state->>'grand_total_cents'=after_state->>'grand_total_cents') THEN RAISE EXCEPTION 'Correction audit missing original/corrected values.'; END IF;
  PERFORM set_config('request.jwt.claim.sub',guest_user::text,true); SELECT * INTO guest_row FROM public.get_booking_operational_read_model() WHERE id=reconciled_booking_id;
  PERFORM set_config('request.jwt.claim.sub',host_user::text,true); SELECT * INTO host_row FROM public.get_booking_operational_read_model() WHERE id=reconciled_booking_id;
  IF guest_row.displayed_total_cents<>40000 OR host_row.displayed_total_cents<>40000 OR guest_row.start_date<>admin_row.start_date OR host_row.start_date<>admin_row.start_date OR guest_row.pickup_location<>admin_row.pickup_location OR host_row.pickup_location<>admin_row.pickup_location OR guest_row.fulfillment_method<>'airport_delivery' OR host_row.fulfillment_method<>'airport_delivery' THEN RAISE EXCEPTION 'Guest/Host/Admin corrected read models disagree.'; END IF;
  PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
  BEGIN PERFORM public.admin_correct_historical_trip_details(reconciled_booking_id,'2039-01-03','11:00','2039-01-04','12:00','Miami International Airport','Miami International Airport','airport_delivery','No change attempt'); RAISE EXCEPTION 'No-op correction allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'No-op correction allowed%' THEN RAISE; END IF; END;
  PERFORM public.admin_correct_historical_trip_details(reconciled_booking_id,'2039-01-03','11:00','2039-01-04','12:00','MIA Terminal 1','MIA Terminal 1','airport_delivery','More precise terminal evidence');
  SELECT count(*) INTO audit_count FROM booking_audit_events WHERE booking_id=reconciled_booking_id AND action_type='historical_trip_details_correction';
  IF audit_count<>2 OR NOT EXISTS(SELECT 1 FROM booking_audit_events WHERE booking_id=reconciled_booking_id AND before_state->>'pickup_location'='Miami International Airport' AND after_state->>'pickup_location'='MIA Terminal 1') THEN RAISE EXCEPTION 'Repeated audit history was not preserved.'; END IF;
  RAISE NOTICE 'PASS: Hotfix 4B.1 display precedence, shared read model, correction audit, privacy and lifecycle/financial isolation';
END $test$;