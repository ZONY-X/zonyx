SELECT no_plan();
CREATE TEMP TABLE guest_renewal_fixture(booking_id uuid,period_id uuid,guest_user uuid,admin_user uuid,other_user uuid,attempt jsonb,original_booking jsonb);
GRANT ALL ON guest_renewal_fixture TO authenticated,service_role;
DO $$
DECLARE b public.bookings%ROWTYPE; actor uuid; guest uuid; other uuid; planned jsonb; period uuid;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE reservation_number='ZNX-000150';
 SELECT user_id INTO actor FROM public.profiles WHERE is_admin LIMIT 1;
 SELECT user_id INTO guest FROM public.profiles WHERE id=b.renter_profile_id;
 SELECT user_id INTO other FROM public.profiles WHERE id<>b.renter_profile_id AND NOT is_admin LIMIT 1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 planned:=public.admin_schedule_rental_extension(b.id,b.end_date+30,b.dropoff_time,158400,true,'Synthetic Guest renewal checkout test');
 PERFORM public.admin_activate_rental_extension((planned->>'plan_id')::uuid);
 SELECT id INTO period FROM public.rental_extension_periods WHERE extension_plan_id=(planned->>'plan_id')::uuid ORDER BY period_number LIMIT 1;
 UPDATE public.bookings SET stripe_customer_id='cus_synthetic',stripe_payment_method_id='pm_synthetic' WHERE id=b.id;
 INSERT INTO guest_renewal_fixture SELECT b.id,period,guest,actor,other,NULL,to_jsonb(x) FROM public.bookings x WHERE x.id=b.id;
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true) FROM guest_renewal_fixture;
SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT get_guest_renewal_details(period_id) FROM guest_renewal_fixture','%different account%','Another account cannot read renewal terms');
SELECT throws_like('SELECT prepare_guest_renewal_checkout(period_id,guest_user,false) FROM guest_renewal_fixture','%permission denied%','Browser cannot impersonate guest to create a payment');
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',guest_user,'role','authenticated')::text,true) FROM guest_renewal_fixture;
SET LOCAL ROLE authenticated;
SELECT is((SELECT get_guest_renewal_details(period_id)->>'can_pay' FROM guest_renewal_fixture),'true','Guest can review active renewal without stored-card collection');
SELECT is((SELECT get_guest_renewal_details(period_id)->>'amount_cents' FROM guest_renewal_fixture),'158400','Server returns exact period amount');
RESET ROLE;
SET LOCAL ROLE service_role;
-- The old Stripe creator/attachment/settlement APIs are deliberately retired.
-- This suite must not require a new Stripe checkout to prove current safety.
SELECT throws_like('SELECT prepare_guest_renewal_checkout(period_id,guest_user,false) FROM guest_renewal_fixture','%permission denied%','Retired Stripe renewal creation is denied even to service_role');
SELECT throws_like('SELECT attach_guest_renewal_session(gen_random_uuid(),''cs_test_retired'',''https://checkout.stripe.com/retired'',now()+interval ''1 hour'')','%permission denied%','Retired Stripe session attachment remains inaccessible');
SELECT throws_like('SELECT record_guest_renewal_evidence(gen_random_uuid(),''cs_test_retired'',''pi_test_retired'',158400,''usd'',false,''paid'')','%permission denied%','Retired Stripe settlement endpoint cannot fabricate a paid renewal');
SELECT is((SELECT count(*)::integer FROM renewal_checkout_attempts WHERE period_id=(SELECT period_id FROM guest_renewal_fixture)),0,'Retired checkout does not create an attempt');
SELECT is((SELECT to_jsonb(b) FROM bookings b WHERE id=(SELECT booking_id FROM guest_renewal_fixture)),(SELECT original_booking FROM guest_renewal_fixture),'Retirement preserves the original booking and historical identifiers');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT record_guest_renewal_evidence(gen_random_uuid(),''cs_test_retired'',''pi_test_retired'',158400,''usd'',false,''paid'')','%permission denied%','Clients cannot forge settlement evidence');
RESET ROLE;
