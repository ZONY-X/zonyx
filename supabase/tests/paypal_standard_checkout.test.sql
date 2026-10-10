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
 VALUES(b,g.id,v.host_profile_id,v.id,(now() AT TIME ZONE 'America/New_York')::date,(now() AT TIME ZONE 'America/New_York')::date+1,'10:00','10:00','Synthetic pickup','Synthetic return','pickup','pending_payment',10000,1200,896,12096,'usd',now(),now());
 summary:=jsonb_build_object('vehicle_id',v.id,'start_date',(now() AT TIME ZONE 'America/New_York')::date,'end_date',(now() AT TIME ZONE 'America/New_York')::date+1,'pickup_time','10:00','dropoff_time','10:00','pickup_location','Synthetic pickup','dropoff_location','Synthetic return','fulfillment_method','pickup','subtotal_cents',10000,'service_fee_cents',1200,'taxes_cents',896,'final_total_cents',12096,'currency','usd','internal_test',true,'authorization_hold_amount_cents',50000);
 INSERT INTO public.booking_rental_agreements(id,booking_id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,accepted_at,accepted_ip,accepted_user_agent,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at)
 VALUES(a,b,b,(SELECT id FROM public.rental_agreement_versions WHERE version='1.4'),'1.4',g.id,g.user_id,now(),'127.0.0.1','isolated-paypal-test',summary,doc,encode(extensions.digest(doc,'sha256'),'hex'),'isolated-paypal',now()+interval '1 hour');
 INSERT INTO paypal_fixture VALUES(b,a,g.user_id,NULL,NULL);
END $fixture$;


SET LOCAL ROLE service_role;
UPDATE paypal_fixture SET result=prepare_paypal_expanded_payment(booking_id,agreement_id,user_id,'sandbox','paypal_wallet');
UPDATE paypal_fixture SET payment_id=(result->'payment'->>'id')::uuid;
SELECT attach_paypal_rental_order(payment_id,'synthetic-rental-order','https://www.sandbox.paypal.com/checkoutnow?token=synthetic-rental-order') FROM paypal_fixture;
SELECT claim_paypal_rental_capture(payment_id,user_id) FROM paypal_fixture;
SELECT finalize_paypal_rental_payment(payment_id,'synthetic-rental-order','synthetic-rental-capture',12096,'usd','disabled') FROM paypal_fixture;
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM paypal_fixture)),'pending_payment','Rental capture alone cannot confirm Standard booking');
SELECT prepare_paypal_sandbox_deposit(payment_id) FROM paypal_fixture;
SELECT attach_paypal_sandbox_deposit(id,'synthetic-hold-order') FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
SELECT claim_paypal_sandbox_authorization(id) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture);
UPDATE paypal_fixture SET result=prepare_paypal_cancellation(payment_id,user_id,'Abandoned Standard deposit authorization');
SELECT is((SELECT (result->>'refund_amount_cents')::bigint FROM paypal_fixture),12096::bigint,'Incomplete checkout refunds full rental including service fee');
SELECT throws_like('SELECT claim_paypal_sandbox_authorization(id) FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)','%already claimed%','Cancellation prevents further deposit authorization');
SELECT throws_like('SELECT record_paypal_cancellation_void((result->>''id'')::uuid,NULL,''NONE'') FROM paypal_fixture','%Unknown deposit%','Unknown authorization cannot be treated as empty');
SELECT lives_ok('SELECT record_paypal_cancellation_void((result->>''id'')::uuid,''late-authorization'',''VOIDED'') FROM paypal_fixture','Canonical void can recover a lost authorization response');
SELECT is((SELECT provider_authorization_id FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)),'late-authorization','Recovered hold identity is persisted');
SELECT claim_paypal_cancellation_step((result->>'id')::uuid,'refund') FROM paypal_fixture;
SELECT attach_paypal_cancellation_refund((result->>'id')::uuid,'full-rental-refund') FROM paypal_fixture;
SELECT record_paypal_cancellation_refund((result->>'id')::uuid,'full-rental-refund','synthetic-rental-capture',12096,'usd','COMPLETED') FROM paypal_fixture;
SELECT lives_ok('SELECT complete_paypal_cancellation((result->>''id'')::uuid) FROM paypal_fixture','Verified full refund and void complete cancellation');
SELECT lives_ok('SELECT complete_paypal_cancellation((result->>''id'')::uuid) FROM paypal_fixture','Repeated cancellation is idempotent');
SELECT is((SELECT captured_amount_cents FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM paypal_fixture)),0::bigint,'No security deposit capture');
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM paypal_fixture)),'cancelled','Unconfirmed reservation released only after refund');
RESET ROLE;
