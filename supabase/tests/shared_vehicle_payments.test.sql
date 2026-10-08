-- No providers or secrets. Roll back all synthetic evidence after each run.
SELECT plan(23);
CREATE TEMP TABLE shared_fixture (booking_id uuid,agreement_id uuid,user_id uuid,payment_id uuid,result jsonb);
GRANT ALL ON shared_fixture TO authenticated,service_role;
DO $fixture$
DECLARE g public.profiles%ROWTYPE; v public.vehicles%ROWTYPE; b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); summary jsonb; doc text:='Synthetic PayPal accepted agreement';
BEGIN
 SELECT * INTO g FROM public.profiles WHERE NOT is_admin ORDER BY created_at LIMIT 1;
 SELECT * INTO v FROM public.vehicles ORDER BY created_at LIMIT 1;
 UPDATE public.profiles SET is_internal_tester=true WHERE id=g.id;
 INSERT INTO public.bookings(id,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,terms_accepted_at,rental_agreement_accepted_at)
 VALUES(b,g.id,v.host_profile_id,v.id,'2090-01-01','2090-01-02','10:00','10:00','Synthetic pickup','Synthetic return','pickup','pending_payment',10000,1200,896,12096,'usd',now(),now());
 summary:=jsonb_build_object('vehicle_id',v.id,'start_date','2090-01-01','end_date','2090-01-02','pickup_time','10:00','dropoff_time','10:00','pickup_location','Synthetic pickup','dropoff_location','Synthetic return','fulfillment_method','pickup','subtotal_cents',10000,'service_fee_cents',1200,'taxes_cents',896,'final_total_cents',12096,'currency','usd','internal_test',true,'authorization_hold_amount_cents',50000);
 INSERT INTO public.booking_rental_agreements(id,booking_id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,accepted_at,accepted_ip,accepted_user_agent,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at)
 VALUES(a,b,b,(SELECT id FROM public.rental_agreement_versions WHERE version='1.4'),'1.4',g.id,g.user_id,now(),'127.0.0.1','isolated-paypal-test',summary,doc,encode(extensions.digest(doc,'sha256'),'hex'),'shared-vehicle',now()+interval '1 hour');
 INSERT INTO shared_fixture VALUES(b,a,g.user_id,NULL,NULL);
END $fixture$;


CREATE TEMP TABLE shared_overlap AS SELECT * FROM shared_fixture WITH NO DATA;
GRANT ALL ON shared_overlap TO service_role;
DO $fixture$
DECLARE f shared_fixture%ROWTYPE; b bookings%ROWTYPE; a booking_rental_agreements%ROWTYPE; b2 uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO f FROM shared_fixture;
 SELECT * INTO b FROM bookings WHERE id=f.booking_id;
 SELECT * INTO a FROM booking_rental_agreements WHERE id=f.agreement_id;
 INSERT INTO bookings(id,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,terms_accepted_at,rental_agreement_accepted_at)
 VALUES(b2,b.renter_profile_id,b.host_profile_id,b.vehicle_id,b.start_date,b.end_date,b.pickup_time,b.dropoff_time,b.pickup_location,b.dropoff_location,b.fulfillment_method,'pending_payment',b.subtotal_cents,b.service_fee_cents,b.taxes_cents,b.grand_total_cents,b.currency,now(),now());
 INSERT INTO booking_rental_agreements SELECT (jsonb_populate_record(NULL::booking_rental_agreements,to_jsonb(a)||jsonb_build_object('id',a2,'booking_id',b2,'proposed_booking_id',b2,'idempotency_key','shared-overlap-'||a2::text))).*;
 INSERT INTO shared_overlap SELECT b2,a2,f.user_id,NULL,NULL;
END $fixture$;
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.vehicle_payment_claims'::regclass),'Claims enforce RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.vehicle_payment_claims','SELECT,INSERT,UPDATE,DELETE'),'Clients cannot alter inventory claims');
SELECT ok(NOT has_function_privilege('authenticated','public.finalize_sandbox_stripe_payment(uuid,text,text,bigint,text)','EXECUTE'),'Clients cannot forge Stripe settlement');
SET LOCAL ROLE service_role;
UPDATE shared_fixture SET payment_id=(reserve_rental_payment_provider(booking_id,agreement_id,'stripe',user_id,'sandbox')).id;
SELECT is((SELECT count(*) FROM vehicle_payment_claims WHERE payment_id=(SELECT payment_id FROM shared_fixture)),1::bigint,'Stripe owns durable inventory before dispatch');
SELECT throws_like('SELECT prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,''sandbox'',''card'') FROM shared_overlap','%Shared vehicle payment reservation conflicts%','Stripe reservation blocks overlapping PayPal creation');
SELECT ok((SELECT claim_sandbox_stripe_dispatch(payment_id) FROM shared_fixture),'Only first Stripe dispatch wins');
SELECT ok((SELECT NOT claim_sandbox_stripe_dispatch(payment_id) FROM shared_fixture),'Unknown Stripe create outcome cannot redispatch');
SELECT throws_like('SELECT reserve_rental_payment_provider(booking_id,agreement_id,''paypal'',user_id,''sandbox'') FROM shared_overlap','%Shared vehicle payment reservation conflicts%','Timeout retains vehicle exclusion');
SELECT lives_ok('SELECT attach_sandbox_stripe_session(payment_id,''cs_test_synthetic'') FROM shared_fixture','Recovery attaches known test session');
SELECT lives_ok('SELECT attach_sandbox_stripe_session(payment_id,''cs_test_synthetic'') FROM shared_fixture','Session attachment retry is idempotent');
SELECT throws_like('SELECT attach_sandbox_stripe_session(payment_id,''cs_test_other'') FROM shared_fixture','%identity conflicts%','Different session cannot overwrite identity');
SELECT throws_like('SELECT finalize_sandbox_stripe_payment(payment_id,''cs_test_synthetic'',''pi_synthetic'',1,''usd'') FROM shared_fixture','%evidence conflicts%','Wrong amount cannot settle');
SELECT lives_ok('SELECT finalize_sandbox_stripe_payment(payment_id,''cs_test_synthetic'',''pi_synthetic'',12096,''usd'') FROM shared_fixture','Canonical synthetic Stripe evidence settles without deposit or trip confirmation');
SELECT lives_ok('SELECT finalize_sandbox_stripe_payment(payment_id,''cs_test_synthetic'',''pi_synthetic'',12096,''usd'') FROM shared_fixture','Duplicate settlement is idempotent');
SELECT throws_like('SELECT finalize_sandbox_stripe_payment(payment_id,''cs_test_synthetic'',''pi_other'',12096,''usd'') FROM shared_fixture','%evidence conflicts%','Delayed different capture cannot overwrite paid evidence');
SELECT throws_like('SELECT prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,''sandbox'',''card'') FROM shared_overlap','%Shared vehicle payment reservation conflicts%','Paid Stripe blocks overlapping PayPal');
SELECT throws_like('UPDATE bookings SET start_date=start_date+1 WHERE id=(SELECT booking_id FROM shared_fixture)','%terms are locked%','Stripe reservation freezes inventory schedule');
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM shared_fixture)),'pending_payment','Stripe settlement does not confirm trip');
SELECT is((SELECT count(*) FROM booking_security_deposits WHERE booking_id=(SELECT booking_id FROM shared_fixture)),0::bigint,'Stripe sandbox settlement creates no deposit');
RESET ROLE;

-- Test-only reset of synthetic evidence inside the rolled-back transaction.
DELETE FROM vehicle_payment_claims WHERE payment_id=(SELECT payment_id FROM shared_fixture);
DELETE FROM booking_payments WHERE id=(SELECT payment_id FROM shared_fixture);
UPDATE bookings SET stripe_checkout_session_id=NULL WHERE id=(SELECT booking_id FROM shared_fixture);
SET LOCAL ROLE service_role;
UPDATE shared_fixture SET result=prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,'sandbox','card');
UPDATE shared_fixture SET payment_id=(result#>>'{payment,id}')::uuid;
SELECT throws_like('SELECT reserve_rental_payment_provider(booking_id,agreement_id,''stripe'',user_id,''sandbox'') FROM shared_overlap','%Shared vehicle payment reservation conflicts%','PayPal-first rejects overlapping Stripe dispatch');
SELECT attach_paypal_rental_order(payment_id,'synthetic-shared-card',NULL) FROM shared_fixture;
SELECT lives_ok('SELECT record_paypal_payment_state(payment_id,''cancelled'') FROM shared_fixture','Synthetic PayPal cancellation records status');
SELECT throws_like('SELECT reserve_rental_payment_provider(booking_id,agreement_id,''stripe'',user_id,''sandbox'') FROM shared_overlap','%Shared vehicle payment reservation conflicts%','Cancellation does not release uncertain inventory');
SELECT is((SELECT count(*) FROM vehicle_payment_claims WHERE payment_id=(SELECT payment_id FROM shared_fixture)),1::bigint,'Claim survives cancellation');
RESET ROLE;
