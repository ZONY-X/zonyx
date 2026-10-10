SELECT no_plan();
CREATE TEMP TABLE minimum_fixture(id uuid);
INSERT INTO minimum_fixture SELECT id FROM vehicles ORDER BY created_at LIMIT 1;
UPDATE vehicles SET minimum_rental_hours=25,base_daily_rate_cents=16600 WHERE id=(SELECT id FROM minimum_fixture);
SELECT throws_like('SELECT validate_vehicle_rental_duration((SELECT id FROM minimum_fixture),''2026-10-10'',''17:00'',''2026-10-11'',''17:00'')','%minimum rental of 25 hours%','Critical 24-hour customer case rejected');
SELECT throws_like('SELECT validate_vehicle_rental_duration((SELECT id FROM minimum_fixture),''2026-10-10'',''17:00'',''2026-10-11'',''16:59'')','%minimum rental%','Below 24 hours rejected');
SELECT is(validate_vehicle_rental_duration((SELECT id FROM minimum_fixture),'2026-10-10','17:00','2026-10-11','18:00'),2,'25 hours billed as two days');
SELECT is(validate_vehicle_rental_duration((SELECT id FROM minimum_fixture),'2026-10-10','17:00','2026-10-12','17:00'),2,'48 hours billed as two days');
SELECT is(validate_vehicle_rental_duration((SELECT id FROM minimum_fixture),'2026-10-10','17:00','2026-10-12','17:01'),3,'More than 48 hours billed as three days');
UPDATE vehicles SET minimum_rental_hours=26 WHERE id=(SELECT id FROM minimum_fixture);
SELECT throws_like('SELECT validate_vehicle_rental_duration((SELECT id FROM minimum_fixture),''2026-10-10'',''17:00'',''2026-10-11'',''18:00'')','%26 hours%','Host change immediately invalidates old dates');
SELECT throws_like('UPDATE vehicles SET minimum_rental_hours=0 WHERE id=(SELECT id FROM minimum_fixture)','%check constraint%','Invalid host minimum rejected');
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='z_booking_minimum_duration'),'Direct booking writes protected');
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='a_payment_minimum_duration'),'Existing orders rechecked at financial claim');
SELECT is(2*16600+round(2*16600*.12)::integer+round(2*16600*.08)::integer-4700,35140,'Two-day price minus single $47 discount is $351.40');

CREATE TEMP TABLE paypal_fixture (booking_id uuid,agreement_id uuid,user_id uuid,payment_id uuid,result jsonb);
GRANT ALL ON paypal_fixture TO authenticated,service_role;
DO $fixture$
DECLARE g public.profiles%ROWTYPE; v public.vehicles%ROWTYPE; b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); summary jsonb; doc text:='Synthetic PayPal accepted agreement';
BEGIN
 SELECT * INTO g FROM public.profiles WHERE NOT is_admin ORDER BY created_at LIMIT 1;
 SELECT * INTO v FROM public.vehicles ORDER BY created_at LIMIT 1;
 v.id:=gen_random_uuid();
 INSERT INTO public.vehicles SELECT (jsonb_populate_record(NULL::public.vehicles,to_jsonb(v)||jsonb_build_object('minimum_rental_hours',1,'vehicle_identifier','deposit-'||v.id::text,'slug','deposit-'||v.id::text,'vin',replace(v.id::text,'-',''),'plate',left(v.id::text,8)))).*;
 UPDATE public.profiles SET is_internal_tester=true WHERE id=g.id;
 INSERT INTO public.bookings(id,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,terms_accepted_at,rental_agreement_accepted_at)
 VALUES(b,g.id,v.host_profile_id,v.id,(now() AT TIME ZONE 'America/New_York')::date,(now() AT TIME ZONE 'America/New_York')::date+1,'10:00','10:00','Synthetic pickup','Synthetic return','pickup','pending_payment',10000,1200,896,12096,'usd',now(),now());
 summary:=jsonb_build_object('vehicle_id',v.id,'start_date',(now() AT TIME ZONE 'America/New_York')::date,'end_date',(now() AT TIME ZONE 'America/New_York')::date+1,'pickup_time','10:00','dropoff_time','10:00','pickup_location','Synthetic pickup','dropoff_location','Synthetic return','fulfillment_method','pickup','subtotal_cents',10000,'service_fee_cents',1200,'taxes_cents',896,'final_total_cents',12096,'currency','usd','internal_test',true,'authorization_hold_amount_cents',50000);
 INSERT INTO public.booking_rental_agreements(id,booking_id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,accepted_at,accepted_ip,accepted_user_agent,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at)
 VALUES(a,b,b,(SELECT id FROM public.rental_agreement_versions WHERE version='1.4'),'1.4',g.id,g.user_id,now(),'127.0.0.1','isolated-paypal-test',summary,doc,encode(extensions.digest(doc,'sha256'),'hex'),'minimum-payment-test',now()+interval '1 hour');
 INSERT INTO paypal_fixture VALUES(b,a,g.user_id,NULL,NULL);
END $fixture$;



SET LOCAL ROLE service_role;
UPDATE paypal_fixture SET result=prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,'sandbox','card');
UPDATE paypal_fixture SET payment_id=(result->'payment'->>'id')::uuid;
SELECT attach_paypal_rental_order(payment_id,'minimum-existing-order',NULL) FROM paypal_fixture;
UPDATE vehicles SET minimum_rental_hours=25 WHERE id=(SELECT vehicle_id FROM bookings WHERE id=(SELECT booking_id FROM paypal_fixture));
SELECT throws_like('SELECT claim_paypal_rental_capture(payment_id,user_id) FROM paypal_fixture','%minimum rental of 25 hours%','Previously generated 24-hour order cannot claim capture after host minimum changes');
SELECT throws_like('INSERT INTO booking_payments(booking_id,agreement_id,provider,environment,amount_cents,currency,state) SELECT booking_id,agreement_id,''paypal'',''sandbox'',12096,''usd'',''creating'' FROM paypal_fixture','%minimum rental of 25 hours%','Direct payment insertion rejects invalid duration before creating provider order');
SELECT is((SELECT state FROM booking_payments WHERE id=(SELECT payment_id FROM paypal_fixture)),'awaiting_approval','Rejected capture preserves existing order without dispatch');
SELECT throws_like('INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,currency) SELECT renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,''pending_payment'',''usd'' FROM bookings WHERE id=(SELECT booking_id FROM paypal_fixture)','%minimum rental%','Direct booking insertion cannot bypass host minimum');
RESET ROLE;
SELECT * FROM finish();

