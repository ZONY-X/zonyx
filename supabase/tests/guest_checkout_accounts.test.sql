SELECT no_plan();
INSERT INTO auth.users(id,email,is_anonymous) VALUES('eeeeeeee-0000-4000-8000-000000000001',NULL,true);
INSERT INTO auth.users(id,email) VALUES('eeeeeeee-0000-4000-8000-000000000002','customer@example.invalid'),('eeeeeeee-0000-4000-8000-000000000003','other@example.invalid');
INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous) VALUES('eeeeeeee-0000-4000-8000-000000000004','customer@example.invalid',now(),true);
REVOKE ALL ON auth.users FROM service_role;
SELECT ok(NOT has_table_privilege('service_role','auth.users','SELECT') AND NOT has_table_privilege('service_role','auth.users','UPDATE'),'Service role has no direct Auth table access');
SELECT ok((SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='guest_checkout_private' AND p.proname IN ('lock_anonymous_user','verified_user_email')),'Auth helpers are private, service-only definers with fixed search path');
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT id FROM auth.users LIMIT 1$$,'%permission denied%','Service role cannot read Auth directly');
SELECT throws_like($$UPDATE auth.users SET email='attacker@example.invalid'$$,'%permission denied%','Service role cannot update Auth directly');
SELECT save_guest_checkout_contact('eeeeeeee-0000-4000-8000-000000000001','Guest Driver',' Customer@Example.Invalid ','+1 305 555 0123');
SELECT save_guest_checkout_contact('eeeeeeee-0000-4000-8000-000000000001','Guest Driver','customer@example.invalid','+1 305 555 0123');
SELECT is((SELECT count(*) FROM guest_checkout_private.contacts),1::bigint,'Contact retries reuse one guest identity');
SELECT throws_like($$SELECT save_guest_checkout_contact('eeeeeeee-0000-4000-8000-000000000002','Attacker','customer@example.invalid','+1 305 555 0123')$$,'%Guest identity required%','Permanent account cannot impersonate guest registration');
RESET ROLE;
SELECT is((SELECT email FROM auth.users WHERE id='eeeeeeee-0000-4000-8000-000000000001'),NULL::text,'Entered email never becomes an authenticated email');
CREATE TEMP TABLE paypal_fixture (booking_id uuid,agreement_id uuid,user_id uuid,payment_id uuid,result jsonb);
GRANT ALL ON paypal_fixture TO authenticated,service_role;
DO $fixture$
DECLARE g public.profiles%ROWTYPE; v public.vehicles%ROWTYPE; b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); summary jsonb; doc text:='Synthetic PayPal accepted agreement';
BEGIN
 SELECT * INTO g FROM public.profiles WHERE user_id='eeeeeeee-0000-4000-8000-000000000001';
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

SELECT ok(NOT has_schema_privilege('authenticated','guest_checkout_private','USAGE'),'Private account tables unavailable to browser sessions');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='guest_checkout_private' AND c.relkind='r'),'Every new table has RLS');
SELECT ok(NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT p.prosecdef,'Server-only invoker function: '||p.proname)
FROM pg_proc p WHERE proname IN ('save_guest_checkout_contact','assert_guest_checkout_contact','claim_guest_account_invitations','finish_guest_account_invitation','get_guest_checkout_account_status','get_verified_guest_account_bookings','guest_checkout_handover');
SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT get_verified_guest_account_bookings(''eeeeeeee-0000-4000-8000-000000000002'')','%permission denied%','Client cannot claim another account ID');
SELECT throws_like($$SELECT guest_checkout_private.verified_user_email('eeeeeeee-0000-4000-8000-000000000002')$$,'%permission denied%','Client cannot invoke private Auth helper');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_like($$SELECT guest_checkout_private.lock_anonymous_user('eeeeeeee-0000-4000-8000-000000000001')$$,'%permission denied%','Anonymous browser cannot invoke private Auth helper');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT save_guest_checkout_contact('eeeeeeee-0000-4000-8000-000000000001','Guest Driver','other@example.invalid','+1 305 555 0123')$$,'%Contact details are fixed%','Prepared/accepted contact email cannot be swapped');
SELECT is((SELECT count(*) FROM claim_guest_account_invitations(true)),0::bigint,'No invitation before payment');
UPDATE paypal_fixture SET result=prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,'sandbox','card');
UPDATE paypal_fixture SET payment_id=(result->'payment'->>'id')::uuid;
SELECT is((SELECT (prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,'sandbox','card')->>'dispatch')::boolean FROM paypal_fixture),false,'Duplicate guest payment preparation cannot dispatch twice');
SELECT attach_paypal_rental_order(payment_id,'synthetic-rental-order',NULL) FROM paypal_fixture;
SELECT is((SELECT count(*) FROM claim_guest_account_invitations(true)),0::bigint,'Unpaid/failed checkout cannot invite an account');
SELECT claim_paypal_rental_capture(payment_id,user_id) FROM paypal_fixture;
SELECT finalize_paypal_rental_payment(payment_id,'synthetic-rental-order','synthetic-rental-capture',12096,'usd','disabled') FROM paypal_fixture;
SELECT is((SELECT count(*) FROM claim_guest_account_invitations(true)),0::bigint,'Paid rental with missing deposit cannot invite');
SELECT prepare_paypal_sandbox_deposit(payment_id) FROM paypal_fixture;
SELECT attach_paypal_sandbox_deposit(id,'synthetic-hold-order') FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
SELECT claim_paypal_sandbox_authorization(id) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
SELECT record_paypal_sandbox_authorization(id,'synthetic-hold-order','synthetic-hold',50000,'usd',now(),now()+interval '29 days') FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
SELECT is((SELECT count(*) FROM claim_guest_account_invitations(false)),0::bigint,'Default worker does not send sandbox invitations');
CREATE TEMP TABLE claimed_jobs AS SELECT * FROM claim_guest_account_invitations(true);
SELECT is((SELECT count(*) FROM claimed_jobs),1::bigint,'Canonical booking confirmation creates one invitation');
SELECT is((SELECT count(*) FROM claim_guest_account_invitations(true)),0::bigint,'Concurrent/repeated worker cannot claim a leased job');
SELECT is((SELECT count(*) FROM guest_checkout_private.invitations),1::bigint,'Duplicate worker delivery creates no duplicate invitation');
SELECT throws_like($$SELECT get_verified_guest_account_bookings('eeeeeeee-0000-4000-8000-000000000002')$$,'%Verified email required%','Unverified existing customer cannot claim bookings');
SELECT throws_like($$SELECT get_verified_guest_account_bookings('eeeeeeee-0000-4000-8000-000000000001')$$,'%Verified email required%','Temporary guest is not a verified email account');
SELECT throws_like($$SELECT get_verified_guest_account_bookings('eeeeeeee-0000-4000-8000-000000000004')$$,'%Verified email required%','Confirmed anonymous identity cannot claim a verified email account');
SELECT throws_like($$SELECT get_verified_guest_account_bookings('eeeeeeee-0000-4000-8000-000000000099')$$,'%Verified email required%','Unknown identity cannot claim a verified email account');
SELECT throws_like('SELECT get_guest_checkout_account_status(''eeeeeeee-0000-4000-8000-000000000003'',booking_id) FROM paypal_fixture','%Booking not found%','Other customer cannot inspect original guest receipt');
SELECT is((SELECT (get_guest_checkout_account_status(user_id,booking_id)->>'confirmed')::boolean FROM paypal_fixture),true,'Guest browser can observe canonical confirmation');

CREATE TEMP TABLE financial_snapshot AS SELECT to_jsonb(b) booking,to_jsonb(p) payment,to_jsonb(d) deposit,to_jsonb(a) agreement
FROM bookings b JOIN booking_payments p ON p.booking_id=b.id JOIN booking_security_deposits d ON d.rental_payment_id=p.id JOIN booking_rental_agreements a ON a.id=p.agreement_id WHERE b.id=(SELECT booking_id FROM paypal_fixture);
SELECT finish_guest_account_invitation(booking_id,lease_id,false) FROM claimed_jobs;
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM paypal_fixture)),'confirmed','Email failure does not invalidate booking');
SELECT is((SELECT count(*) FROM claim_guest_account_invitations(true)),0::bigint,'Email retry respects backoff');
UPDATE guest_checkout_private.invitations SET next_attempt_at=now()-interval '1 second';
CREATE TEMP TABLE retried_jobs AS SELECT * FROM claim_guest_account_invitations(true);
SELECT is((SELECT count(*) FROM retried_jobs),1::bigint,'Failed email can retry independently');
SELECT finish_guest_account_invitation(booking_id,lease_id,true) FROM claimed_jobs;
SELECT is((SELECT sent_at IS NULL FROM guest_checkout_private.invitations),true,'Expired worker cannot mark a newer lease delivered');
SELECT finish_guest_account_invitation(booking_id,lease_id,true) FROM retried_jobs;
SELECT is((SELECT count(*) FROM claim_guest_account_invitations(true)),0::bigint,'Successful invitation is not resent on duplicate tick');

RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now() WHERE id IN ('eeeeeeee-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000003');
SET LOCAL ROLE service_role;
SELECT is(jsonb_array_length(get_verified_guest_account_bookings('eeeeeeee-0000-4000-8000-000000000002')),1,'Verified existing email securely links the guest booking');
SELECT is(jsonb_array_length(get_verified_guest_account_bookings('eeeeeeee-0000-4000-8000-000000000002')),1,'Activation replay is idempotent');
SELECT is((SELECT count(*) FROM guest_checkout_private.account_access),1::bigint,'Activation cannot create duplicate links');
SELECT is(jsonb_array_length(get_verified_guest_account_bookings('eeeeeeee-0000-4000-8000-000000000003')),0,'Different verified email sees no booking');
SELECT is((SELECT jsonb_build_array(to_jsonb(b),to_jsonb(p),to_jsonb(d),to_jsonb(a)) FROM bookings b JOIN booking_payments p ON p.booking_id=b.id JOIN booking_security_deposits d ON d.rental_payment_id=p.id JOIN booking_rental_agreements a ON a.id=p.agreement_id WHERE b.id=(SELECT booking_id FROM paypal_fixture)),(SELECT jsonb_build_array(booking,payment,deposit,agreement) FROM financial_snapshot),'Mail retries and account activation preserve every financial record and original signer');
RESET ROLE;
SELECT is((SELECT count(*) FROM auth.users WHERE lower(email)='customer@example.invalid' AND NOT is_anonymous),1::bigint,'Existing customer account is not duplicated');
SET LOCAL ROLE service_role;
SELECT throws_like('UPDATE bookings SET trip_status=''active'' WHERE id=(SELECT booking_id FROM paypal_fixture)','%Verify guest identity%','Guest trip cannot start without staff identity/license verification');
SELECT throws_like('SELECT guest_checkout_handover(''eeeeeeee-0000-4000-8000-000000000002'',booking_id,true) FROM paypal_fixture','%Host or administrator required%','Verified customer cannot approve their own handover');
SELECT is((SELECT (guest_checkout_handover((SELECT user_id FROM profiles WHERE is_admin LIMIT 1),booking_id,false)->>'verified')::boolean FROM paypal_fixture),false,'Host/admin sees unverified handover');
SELECT lives_ok('SELECT guest_checkout_handover((SELECT user_id FROM profiles WHERE is_admin LIMIT 1),booking_id,true) FROM paypal_fixture','Authorized staff can record document checks after confirmation');
SELECT lives_ok('SELECT guest_checkout_handover((SELECT user_id FROM profiles WHERE is_admin LIMIT 1),booking_id,true) FROM paypal_fixture','Handover verification retry is idempotent');
SELECT is((SELECT count(*) FROM guest_checkout_private.handover_verifications),1::bigint,'One audited handover verification per guest booking');
SELECT throws_like('UPDATE bookings SET trip_status=''active'' WHERE id=(SELECT booking_id FROM paypal_fixture)','%verified deposit lifecycle%','Handover record alone cannot bypass existing PayPal staff authorization');
SELECT set_config('request.jwt.claim.sub',(SELECT user_id::text FROM profiles WHERE is_admin LIMIT 1),true);
SELECT lives_ok('UPDATE bookings SET trip_status=''active'' WHERE id=(SELECT booking_id FROM paypal_fixture)','Verified guest can start only through unchanged trip/payment guards');
UPDATE guest_checkout_private.invitations SET sent_at=NULL,next_attempt_at=now()-interval '1 second';
SELECT is((SELECT count(*) FROM claim_guest_account_invitations(true)),1::bigint,'Account email retry survives trip start using durable confirmation evidence');
RESET ROLE;
