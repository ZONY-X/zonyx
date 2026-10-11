SELECT no_plan();
CREATE TEMP TABLE square_fixture (booking_id uuid,agreement_id uuid,user_id uuid,payment_id uuid,result jsonb);
GRANT ALL ON square_fixture TO authenticated,service_role;
DO $fixture$
DECLARE g public.profiles%ROWTYPE; v public.vehicles%ROWTYPE; b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); summary jsonb; doc text:='Synthetic Square accepted agreement';
BEGIN
 SELECT * INTO g FROM public.profiles WHERE NOT is_admin ORDER BY created_at LIMIT 1;
 SELECT * INTO v FROM public.vehicles ORDER BY created_at LIMIT 1;
 v.id:=gen_random_uuid();
 INSERT INTO public.vehicles SELECT (jsonb_populate_record(NULL::public.vehicles,to_jsonb(v)||jsonb_build_object('minimum_rental_hours',1,'vehicle_identifier','deposit-'||v.id::text,'slug','deposit-'||v.id::text,'vin',replace(v.id::text,'-',''),'plate',left(v.id::text,8)))).*;
 UPDATE public.profiles SET is_internal_tester=true WHERE id=g.id;
 INSERT INTO public.driver_eligibility(profile_id,legal_name,date_of_birth,license_issuing_country,license_issuing_region,license_expiration_date,self_attested_at)
 VALUES(g.id,'Synthetic Driver','1990-01-01','US','FL',current_date+365,now())
 ON CONFLICT(profile_id) DO UPDATE SET license_expiration_date=current_date+365,self_attested_at=now();
 INSERT INTO public.bookings(id,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,terms_accepted_at,rental_agreement_accepted_at)
 VALUES(b,g.id,v.host_profile_id,v.id,(now() AT TIME ZONE 'America/New_York')::date,(now() AT TIME ZONE 'America/New_York')::date+1,'10:00','10:00','Synthetic pickup','Synthetic return','pickup','pending_payment',10000,1200,896,12096,'usd',now(),now());
 summary:=jsonb_build_object('vehicle_id',v.id,'start_date',(now() AT TIME ZONE 'America/New_York')::date,'end_date',(now() AT TIME ZONE 'America/New_York')::date+1,'pickup_time','10:00','dropoff_time','10:00','pickup_location','Synthetic pickup','dropoff_location','Synthetic return','fulfillment_method','pickup','subtotal_cents',10000,'service_fee_cents',1200,'taxes_cents',896,'final_total_cents',12096,'currency','usd','internal_test',true,'authorization_hold_amount_cents',50000);
 INSERT INTO public.booking_rental_agreements(id,booking_id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,accepted_at,accepted_ip,accepted_user_agent,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at)
 VALUES(a,b,b,(SELECT id FROM public.rental_agreement_versions WHERE version='1.4'),'1.4',g.id,g.user_id,now(),'127.0.0.1','isolated-square-test',summary,doc,encode(extensions.digest(doc,'sha256'),'hex'),'isolated-square',now()+interval '1 hour');
 INSERT INTO square_fixture VALUES(b,a,g.user_id,NULL,NULL);
END $fixture$;


SET LOCAL ROLE service_role;
UPDATE square_fixture SET result=prepare_square_payment(booking_id,agreement_id,user_id);
UPDATE square_fixture SET payment_id=(result->'payment'->>'id')::uuid;
SELECT is((SELECT result->>'dispatch' FROM square_fixture),'true','One initial hold dispatch');
SELECT is((SELECT prepare_square_payment(booking_id,agreement_id,user_id)->>'dispatch' FROM square_fixture),'false','Retry never dispatches a second hold');
SELECT throws_like('SELECT reserve_rental_payment_provider(booking_id,agreement_id,''paypal'',user_id,''sandbox'') FROM square_fixture','%conflicts%','PayPal cannot replace Square after reservation');
SELECT throws_like('SELECT claim_square_step(payment_id,''rental'',user_id) FROM square_fixture','%deposit required%','Rental cannot charge without a hold');
SELECT throws_like('SELECT record_square_payment(payment_id,true,''hold-id'',''APPROVED'',1,now()+interval ''7 days'') FROM square_fixture','%evidence conflicts%','Reject mismatched deposit amount');
SELECT throws_like('UPDATE bookings SET trip_status=''confirmed'' WHERE id=(SELECT booking_id FROM square_fixture)','%verified release%','No confirmation before canonical rental and hold');
SELECT record_square_payment(payment_id,true,'hold-id','APPROVED',50000,now()+interval '7 days') FROM square_fixture;
SELECT is((SELECT claim_square_step(payment_id,'rental',user_id)->>'dispatch' FROM square_fixture),'true','One rental dispatch with valid deposit');
SELECT is((SELECT claim_square_step(payment_id,'rental',user_id)->>'dispatch' FROM square_fixture),'false','Rental retry sends no second POST');
SELECT record_square_payment(payment_id,false,'rental-id','COMPLETED',12096) FROM square_fixture;
SELECT is((SELECT state FROM booking_payments WHERE id=(SELECT payment_id FROM square_fixture)),'paid','Canonical rental evidence recorded');
UPDATE vehicles SET is_active=false WHERE id=(SELECT vehicle_id FROM bookings WHERE id=(SELECT booking_id FROM square_fixture));
SELECT reconcile_square_booking(payment_id) FROM square_fixture;
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM square_fixture)),'pending_payment','Inactive vehicle cannot confirm despite paid rental');
UPDATE vehicles SET is_active=true WHERE id=(SELECT vehicle_id FROM bookings WHERE id=(SELECT booking_id FROM square_fixture));
SELECT record_square_payment(payment_id,false,'rental-id','COMPLETED',12096) FROM square_fixture;
SELECT reconcile_square_booking(payment_id) FROM square_fixture;
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM square_fixture)),'confirmed','Canonical rental plus separate hold confirms trip');
SELECT is((SELECT get_provider_rental_payment_receipt(booking_id)->>'bookingConfirmed' FROM square_fixture),'true','Receipt reports verified confirmation');
SELECT lives_ok('SELECT reconcile_square_booking(payment_id) FROM square_fixture','Confirmation recovery is idempotent');
SELECT throws_like('UPDATE bookings SET stripe_customer_id=''cus_fake'' WHERE id=(SELECT booking_id FROM square_fixture)','%verified release%','Square cannot acquire Stripe identifiers');
SELECT is((SELECT claim_square_step(payment_id,'rental',user_id)->>'dispatch' FROM square_fixture),'false','Confirmed retry retains original rental');
SELECT claim_square_step(payment_id,'cancel',user_id,'Synthetic cancellation') FROM square_fixture;
SELECT is((SELECT claim_square_step(payment_id,'void',user_id)->>'dispatch' FROM square_fixture),'true','One void dispatch');
SELECT is((SELECT claim_square_step(payment_id,'void',user_id)->>'dispatch' FROM square_fixture),'false','Void retry does not POST');
SELECT throws_like('SELECT claim_square_step(payment_id,''refund'',user_id) FROM square_fixture','%Canonical void%','Refund waits for verified void');
SELECT record_square_payment(payment_id,true,'hold-id','CANCELED',50000) FROM square_fixture;
SELECT record_square_payment(payment_id,true,'hold-id','APPROVED',50000,now()+interval '7 days') FROM square_fixture;
SELECT is((SELECT status FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM square_fixture)),'voided','Late authorization cannot resurrect voided hold');
SELECT is((SELECT claim_square_step(payment_id,'refund',user_id)->>'dispatch' FROM square_fixture),'true','One refund dispatch');
SELECT is((SELECT claim_square_step(payment_id,'refund',user_id)->>'dispatch' FROM square_fixture),'false','Refund retry does not POST');
SELECT throws_like('SELECT record_square_refund(payment_id,''refund-id'',''rental-id'',1,''COMPLETED'') FROM square_fixture','%integrity failure%','Refund amount must match accepted policy');
SELECT is((SELECT count(*)::integer FROM vehicle_payment_claims WHERE payment_id=(SELECT payment_id FROM square_fixture) AND released_at IS NULL),1,'Pending cancellation retains inventory');
SELECT record_square_refund(payment_id,'refund-id','rental-id',10896,'COMPLETED') FROM square_fixture;
SELECT record_square_refund(payment_id,'refund-id','rental-id',10896,'PENDING') FROM square_fixture;
SELECT is((SELECT refund_status FROM square_payment_operations WHERE payment_id=(SELECT payment_id FROM square_fixture)),'COMPLETED','Refund success is monotonic');
SELECT is((SELECT captured_amount_cents FROM booking_security_deposits WHERE rental_payment_id=(SELECT payment_id FROM square_fixture)),0::bigint,'Deposit was never captured');
SELECT is((SELECT get_provider_rental_payment_receipt(booking_id)->>'refundedAmountCents' FROM square_fixture),'10896','Neutral receipt includes Square refund evidence');
SELECT complete_square_cancellation(payment_id) FROM square_fixture;
SELECT is((SELECT trip_status FROM bookings WHERE id=(SELECT booking_id FROM square_fixture)),'cancelled','Only canonical refund and void can cancel booking');
SELECT is((SELECT count(*)::integer FROM vehicle_payment_claims WHERE payment_id=(SELECT payment_id FROM square_fixture) AND released_at IS NOT NULL),1,'Verified cancellation releases inventory');
SELECT record_square_payment(payment_id,false,'rental-id','COMPLETED',12096) FROM square_fixture;
SELECT is((SELECT state FROM booking_payments WHERE id=(SELECT payment_id FROM square_fixture)),'cancelled','Late rental evidence cannot reopen cancellation');
SELECT lives_ok('SELECT complete_square_cancellation(payment_id) FROM square_fixture','Cancellation completion is idempotent');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT reconcile_square_booking(payment_id) FROM square_fixture','%permission denied%','Clients cannot forge booking confirmation');
SELECT throws_like('SELECT prepare_square_payment(booking_id,agreement_id,user_id) FROM square_fixture','%permission denied%','Authenticated clients cannot invoke privileged preparation');
RESET ROLE;
