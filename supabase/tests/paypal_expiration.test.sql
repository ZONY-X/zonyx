SELECT no_plan();
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
 VALUES(b,g.id,v.host_profile_id,v.id,(now() AT TIME ZONE 'America/New_York')::date,(now() AT TIME ZONE 'America/New_York')::date+1,'00:00','00:00','Synthetic pickup','Synthetic return','pickup','pending_payment',10000,1200,896,12096,'usd',now(),now());
 summary:=jsonb_build_object('vehicle_id',v.id,'start_date',(now() AT TIME ZONE 'America/New_York')::date,'end_date',(now() AT TIME ZONE 'America/New_York')::date+1,'pickup_time','00:00','dropoff_time','00:00','pickup_location','Synthetic pickup','dropoff_location','Synthetic return','fulfillment_method','pickup','subtotal_cents',10000,'service_fee_cents',1200,'taxes_cents',896,'final_total_cents',12096,'currency','usd','internal_test',true,'authorization_hold_amount_cents',50000);
 INSERT INTO public.booking_rental_agreements(id,booking_id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,accepted_at,accepted_ip,accepted_user_agent,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at)
 VALUES(a,b,b,(SELECT id FROM public.rental_agreement_versions WHERE version='1.4'),'1.4',g.id,g.user_id,now(),'127.0.0.1','isolated-paypal-test',summary,doc,encode(extensions.digest(doc,'sha256'),'hex'),'isolated-paypal',now()+interval '1 hour');
 INSERT INTO paypal_fixture VALUES(b,a,g.user_id,NULL,NULL);
END $fixture$;


SET LOCAL ROLE service_role;
UPDATE paypal_fixture SET result=prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,'sandbox','card');
UPDATE paypal_fixture SET payment_id=(result->'payment'->>'id')::uuid;
SELECT attach_paypal_rental_order(payment_id,'synthetic-rental-order',NULL) FROM paypal_fixture;
SELECT claim_paypal_rental_capture(payment_id,user_id) FROM paypal_fixture;
SELECT finalize_paypal_rental_payment(payment_id,'synthetic-rental-order','synthetic-rental-capture',12096,'usd','disabled') FROM paypal_fixture;
SELECT ok((SELECT (prepare_paypal_sandbox_deposit(payment_id)->>'dispatch')::boolean FROM paypal_fixture),'First deposit creation claims dispatch');
SELECT ok((SELECT NOT (prepare_paypal_sandbox_deposit(payment_id)->>'dispatch')::boolean FROM paypal_fixture),'Unknown create outcome never redispatches');
SELECT attach_paypal_sandbox_deposit(id,'synthetic-hold-order') FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
SELECT lives_ok('SELECT claim_paypal_sandbox_authorization(id) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','First authorization claim wins');
SELECT throws_like('SELECT claim_paypal_sandbox_authorization(id) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','%already claimed%','Unknown authorization cannot blindly retry');
SELECT throws_like('SELECT record_paypal_sandbox_authorization(id,''wrong-order'',''synthetic-hold'',50000,''usd'',now(),now()+interval ''29 days'') FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','%integrity failure%','Mismatched order cannot confirm');
SELECT lives_ok('SELECT record_paypal_sandbox_authorization(id,''synthetic-hold-order'',''synthetic-hold'',50000,''usd'',now(),now()+interval ''29 days'') FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','Verified hold confirms covered short trip');
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM paypal_fixture)),'confirmed','Rental and hold jointly confirm booking');
SELECT is((SELECT captured_amount_cents FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)),0::bigint,'Security deposit is never captured');
SELECT lives_ok('SELECT record_paypal_sandbox_authorization(id,''synthetic-hold-order'',''synthetic-hold'',50000,''usd'',authorized_at,expires_at) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','Duplicate authorization is idempotent');
SELECT throws_like('SELECT record_paypal_sandbox_authorization(id,''synthetic-hold-order'',''different-hold'',50000,''usd'',now(),now()+interval ''29 days'') FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','%Conflicting authorization%','Duplicate cannot replace hold identity');
SELECT ok((SELECT (get_provider_rental_payment_receipt(booking_id)->>'bookingConfirmed')::boolean FROM paypal_fixture),'Receipt reports persisted confirmation');
RESET ROLE;
SELECT ok(NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE'),'Deposit RPC service-only: '||p.proname)
FROM pg_proc p WHERE proname IN ('prepare_paypal_sandbox_deposit','attach_paypal_sandbox_deposit','claim_paypal_sandbox_authorization','record_paypal_sandbox_authorization');


SET LOCAL ROLE service_role;
SELECT lives_ok('SELECT paypal_card_checkout_preflight(booking_id) FROM paypal_fixture','Short trip fits initial hold policy');
UPDATE booking_security_deposits SET honor_period_ends_at=now()-interval '1 hour' WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
SELECT refresh_paypal_deposit_coverage(id,provider_authorization_id,'CREATED',expires_at) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
SELECT is((SELECT status FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)),'renewal_required','Elapsed honor period requires renewal despite unexpired 29-day authorization');
SELECT ok((SELECT NOT (get_provider_rental_payment_receipt(booking_id)->>'bookingConfirmed')::boolean FROM paypal_fixture),'Elapsed hold cannot falsely confirm');
SELECT refresh_paypal_deposit_coverage(id,provider_authorization_id,'EXPIRED',expires_at) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
SELECT is((SELECT status FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)),'expired','Canonical provider expiration persisted');
SELECT throws_like('SELECT refresh_paypal_deposit_coverage(id,provider_authorization_id,''CREATED'',expires_at) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','%cannot regress%','Delayed authorization-created webhook cannot revive expired hold');
SELECT throws_like('SELECT record_paypal_sandbox_authorization(id,''synthetic-hold-order'',''synthetic-hold'',50000,''usd'',authorized_at,expires_at) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','%Terminal deposit%','Expired hold cannot regain confirmation');
RESET ROLE;
