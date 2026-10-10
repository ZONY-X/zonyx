SELECT no_plan();
CREATE TEMP TABLE square_fixture (booking_id uuid,agreement_id uuid,user_id uuid,payment_id uuid,result jsonb);
GRANT ALL ON square_fixture TO authenticated,service_role;
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
 VALUES(a,b,b,(SELECT id FROM public.rental_agreement_versions WHERE version='1.4'),'1.4',g.id,g.user_id,now(),'127.0.0.1','isolated-square-failed-test',summary,doc,encode(extensions.digest(doc,'sha256'),'hex'),'isolated-square-failed',now()+interval '1 hour');
 INSERT INTO square_fixture VALUES(b,a,g.user_id,NULL,NULL);
END $fixture$;


SET LOCAL ROLE service_role;
UPDATE square_fixture SET result=prepare_square_payment(booking_id,agreement_id,user_id);
UPDATE square_fixture SET payment_id=(result->'payment'->>'id')::uuid;
SELECT record_square_payment(payment_id,true,'hold-failed-rental','APPROVED',50000,now()+interval '7 days') FROM square_fixture;
SELECT claim_square_step(payment_id,'rental',user_id) FROM square_fixture;
SELECT record_square_payment(payment_id,false,'failed-rental','FAILED',12096) FROM square_fixture;
SELECT is((SELECT state FROM booking_payments WHERE id=(SELECT payment_id FROM square_fixture)),'failed','Canonical failed charge has no captured money');
SELECT claim_square_step(payment_id,'cancel',user_id,'Failed rental cancellation') FROM square_fixture;
SELECT claim_square_step(payment_id,'void',user_id) FROM square_fixture;
SELECT record_square_payment(payment_id,true,'hold-failed-rental','CANCELED',50000) FROM square_fixture;
SELECT lives_ok('SELECT complete_square_cancellation(payment_id) FROM square_fixture','Failed rental can cancel after verified void without fabricated refund');
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM square_fixture)),'cancelled','Failed rental cancellation is persisted');
RESET ROLE;
