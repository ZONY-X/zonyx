-- Real pgTAP assertions against the complete launch schema. Synthetic records
-- only: these RPCs never call a payment provider or move money.
SELECT plan(46);
SELECT has_table('public','booking_payments','Provider-neutral payments exist');
SELECT has_table('public','booking_security_deposits','Deposits are separate');
SELECT has_table('public','payment_webhook_receipts','Webhook deduplication exists');
SELECT col_type_is('public','booking_payments','checkout_method','text','Expanded checkout method exists');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.booking_payments'::regclass,'public.booking_security_deposits'::regclass,'public.payment_webhook_receipts'::regclass)),'All payment tables enforce RLS');
SELECT ok(NOT has_table_privilege('anon','public.booking_payments','SELECT,INSERT,UPDATE,DELETE'),'Anon has no payment privileges');
SELECT ok(NOT has_table_privilege('authenticated','public.booking_payments','INSERT,UPDATE,DELETE'),'Clients cannot write payment identities');
SELECT ok(NOT has_table_privilege('authenticated','public.payment_webhook_receipts','SELECT,INSERT,UPDATE,DELETE'),'Clients cannot inspect or write webhook receipts');
SELECT ok(NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE'),'Service-only RPC: '||p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('reserve_rental_payment_provider','prepare_paypal_rental_payment','prepare_paypal_expanded_payment','attach_paypal_rental_order','claim_paypal_rental_capture','record_paypal_payment_state','finalize_paypal_rental_payment') ORDER BY p.proname;

CREATE TEMP TABLE paypal_fixture (booking_id uuid,agreement_id uuid,user_id uuid,payment_id uuid,result jsonb);
GRANT ALL ON paypal_fixture TO authenticated,service_role;
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
 VALUES(a,b,b,(SELECT id FROM public.rental_agreement_versions WHERE version='1.4'),'1.4',g.id,g.user_id,now(),'127.0.0.1','isolated-paypal-test',summary,doc,encode(extensions.digest(doc,'sha256'),'hex'),'isolated-paypal',now()+interval '1 hour');
 INSERT INTO paypal_fixture VALUES(b,a,g.user_id,NULL,NULL);
END $fixture$;

SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,''sandbox'',''card'') FROM paypal_fixture','%permission denied%','Client cannot prepare payments');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE paypal_fixture SET result=prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,'sandbox','card');
UPDATE paypal_fixture SET payment_id=(result->'payment'->>'id')::uuid;
SELECT ok((SELECT (result->>'dispatch')::boolean FROM paypal_fixture),'First request owns dispatch');
SELECT is((SELECT result#>>'{payment,checkout_method}' FROM paypal_fixture),'card','Card method is durable');
SELECT ok((SELECT NOT (prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,'sandbox','card')->>'dispatch')::boolean FROM paypal_fixture),'Retry cannot create a second order');
SELECT is((SELECT count(*) FROM booking_payments WHERE booking_id=(SELECT booking_id FROM paypal_fixture)),1::bigint,'One durable payment per booking');
SELECT throws_like('SELECT prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,''sandbox'',''paypal_wallet'') FROM paypal_fixture','%method is locked%','Method cannot change on retry');
SELECT throws_like('SELECT reserve_rental_payment_provider(booking_id,agreement_id,''stripe'',user_id,''sandbox'') FROM paypal_fixture','%conflicts%','Provider cannot change');
SELECT throws_like('SELECT reserve_rental_payment_provider(booking_id,agreement_id,''paypal'',user_id,''live'') FROM paypal_fixture','%conflicts%','Environment cannot change');
SELECT throws_like('SELECT reserve_rental_payment_provider(booking_id,agreement_id,''paypal'',gen_random_uuid(),''sandbox'') FROM paypal_fixture','%Accepted agreement required%','Another user cannot claim the payment');
SELECT throws_like('UPDATE bookings SET stripe_checkout_session_id=''synthetic-stripe'' WHERE id=(SELECT booking_id FROM paypal_fixture)','%cannot use Stripe%','PayPal booking cannot receive Stripe identity');
SELECT throws_like('SELECT attach_paypal_rental_order(payment_id,''synthetic-order'',''https://www.sandbox.paypal.com/checkoutnow'') FROM paypal_fixture','%no longer eligible%','Card order cannot accept wallet redirect');
SELECT lives_ok('SELECT attach_paypal_rental_order(payment_id,''synthetic-order'',NULL) FROM paypal_fixture','Card order attaches without redirect');
SELECT is((SELECT state FROM booking_payments WHERE id=(SELECT payment_id FROM paypal_fixture)),'awaiting_approval','Order awaits approval');
SELECT throws_like('SELECT attach_paypal_rental_order(payment_id,''second-order'',NULL) FROM paypal_fixture','%no longer eligible%','Order attachment cannot repeat');
SELECT lives_ok('SELECT claim_paypal_rental_capture(payment_id,user_id) FROM paypal_fixture','First capture claim succeeds');
SELECT throws_like('SELECT claim_paypal_rental_capture(payment_id,user_id) FROM paypal_fixture','%already claimed%','Second capture claim is rejected');
SELECT throws_like('UPDATE bookings SET grand_total_cents=1 WHERE id=(SELECT booking_id FROM paypal_fixture)','%terms are locked%','Financial terms remain locked');
SELECT throws_like('UPDATE bookings SET trip_status=''cancelled'' WHERE id=(SELECT booking_id FROM paypal_fixture)','%requires verified%','In-flight capture blocks cancellation');
SELECT throws_like('SELECT finalize_paypal_rental_payment(payment_id,''synthetic-order'',''synthetic-capture'',1,''usd'',''disabled'') FROM paypal_fixture','%integrity failure%','Wrong amount cannot become paid');
SELECT throws_like('SELECT finalize_paypal_rental_payment(payment_id,''wrong-order'',''synthetic-capture'',12096,''usd'',''disabled'') FROM paypal_fixture','%integrity failure%','Wrong order cannot become paid');
SELECT lives_ok('SELECT finalize_paypal_rental_payment(payment_id,''synthetic-order'',''synthetic-capture'',12096,''usd'',''disabled'') FROM paypal_fixture','Verified synthetic evidence finalizes');
SELECT lives_ok('SELECT finalize_paypal_rental_payment(payment_id,''synthetic-order'',''synthetic-capture'',12096,''usd'',''disabled'') FROM paypal_fixture','Finalization retry is idempotent');
SELECT is((SELECT state FROM booking_payments WHERE id=(SELECT payment_id FROM paypal_fixture)),'paid','Paid evidence is durable');
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM paypal_fixture)),'pending_payment','Payment does not confirm the trip');
SELECT is((SELECT count(*) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)),1::bigint,'Deposit is created once');
SELECT is((SELECT status FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)),'disabled','Deposit capability remains disabled');
SELECT is((SELECT amount_cents FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)),50000::bigint,'Deposit amount comes from accepted agreement');
SELECT throws_like('SELECT finalize_paypal_rental_payment(payment_id,''synthetic-order'',''another-capture'',12096,''usd'',''disabled'') FROM paypal_fixture','%Duplicate capture identity%','Different capture cannot overwrite paid evidence');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT user_id::text FROM paypal_fixture),true);
SELECT is((SELECT count(*) FROM booking_payments WHERE id=(SELECT payment_id FROM paypal_fixture)),1::bigint,'Owner can read own payment via RLS');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',true);
SELECT is((SELECT count(*) FROM booking_payments WHERE id=(SELECT payment_id FROM paypal_fixture)),0::bigint,'Other guest cannot read payment');
SELECT throws_like('UPDATE booking_payments SET capture_id=''forged'' WHERE id=(SELECT payment_id FROM paypal_fixture)','%permission denied%','Client cannot forge paid evidence');
RESET ROLE;
