SELECT no_plan();
CREATE TEMP TABLE schedule_fixture(booking_id uuid,vehicle_id uuid,agreement_id uuid,admin_user uuid,guest_user uuid,payment_id uuid,quote jsonb,result jsonb,request_id uuid,original_payment jsonb,original_deposit jsonb);
GRANT ALL ON schedule_fixture TO authenticated,service_role;
DO $$
DECLARE v public.vehicles%ROWTYPE; g public.profiles%ROWTYPE; b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); actor uuid; s jsonb; p uuid; doc text:='Entirely synthetic admin reservation change agreement';
BEGIN
 SELECT * INTO g FROM public.profiles WHERE NOT is_admin ORDER BY created_at LIMIT 1;
 SELECT user_id INTO actor FROM public.profiles WHERE is_admin LIMIT 1;
 SELECT * INTO v FROM public.vehicles ORDER BY created_at LIMIT 1;
 v.id:=gen_random_uuid();
 INSERT INTO public.vehicles SELECT (jsonb_populate_record(NULL::public.vehicles,to_jsonb(v)||jsonb_build_object('minimum_rental_hours',1,'base_daily_rate_cents',10000,'vehicle_identifier','schedule-'||v.id,'slug','schedule-'||v.id,'vin',replace(v.id::text,'-',''),'plate',left(v.id::text,8)))).*;
 INSERT INTO public.bookings(id,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,terms_accepted_at,rental_agreement_accepted_at)
 VALUES(b,g.id,v.host_profile_id,v.id,'2098-06-01','2098-06-02','10:00','10:00','Synthetic pickup','Synthetic return','pickup','confirmed',10000,1200,800,12000,'usd',now(),now());
 s:=jsonb_build_object('vehicle_id',v.id,'start_date','2098-06-01','end_date','2098-06-02','pickup_time','10:00','dropoff_time','10:00','pickup_location','Synthetic pickup','dropoff_location','Synthetic return','fulfillment_method','pickup','rental_days',1,'daily_rate_cents',10000,'subtotal_cents',10000,'service_fee_cents',1200,'taxes_cents',800,'final_total_cents',12000,'currency','usd','primary_authorized_driver',jsonb_build_object('legal_name','Synthetic Driver'),'additional_authorized_drivers','[]'::jsonb);
 INSERT INTO public.booking_rental_agreements(id,booking_id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,accepted_at,accepted_ip,accepted_user_agent,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at)
 VALUES(a,b,b,(SELECT id FROM public.rental_agreement_versions WHERE version='1.4'),'1.4',g.id,g.user_id,now(),'127.0.0.1','isolated-admin-schedule-test',s,doc,encode(extensions.digest(doc,'sha256'),'hex'),'schedule-'||b,now()+interval '1 hour');
 INSERT INTO public.booking_payments(booking_id,agreement_id,provider,environment,state,amount_cents,currency,paid_at) VALUES(b,a,'square','live','paid',12000,'usd',now()) RETURNING id INTO p;
 INSERT INTO public.vehicle_payment_claims(payment_id,booking_id,vehicle_id,reserved_span) VALUES(p,b,v.id,tsrange('2098-06-01 10:00','2098-06-02 10:00','[)'));
 INSERT INTO public.booking_security_deposits(booking_id,rental_payment_id,provider,amount_cents,currency,status,provider_authorization_id,authorized_at,expires_at) VALUES(b,p,'square',50000,'usd','authorized','synthetic-hold-'||b,now(),now()+interval '7 days');
 INSERT INTO schedule_fixture SELECT b,v.id,a,actor,g.user_id,p,NULL,NULL,gen_random_uuid(),to_jsonb(bp),(SELECT to_jsonb(d) FROM public.booking_security_deposits d WHERE d.rental_payment_id=p) FROM public.booking_payments bp WHERE bp.id=p;
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',guest_user,'role','authenticated')::text,true) FROM schedule_fixture;
SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT admin_get_reservation_changes(booking_id) FROM schedule_fixture','%Admin required%','Non-admin cannot read amendments');
SELECT throws_like('SELECT admin_preview_reservation_change(booking_id,''2098-06-01'',''10:00'',''2098-06-03'',''10:00'',''extend'') FROM schedule_fixture','%Admin required%','Non-admin cannot preview dates');
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',admin_user,'role','authenticated')::text,true) FROM schedule_fixture;
SET LOCAL ROLE authenticated;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_like('UPDATE bookings SET end_date=''2098-06-03'' WHERE id=(SELECT booking_id FROM schedule_fixture)','%locked%','Direct date write retains existing payment protection');
RESET ROLE;
SET LOCAL ROLE authenticated;
UPDATE schedule_fixture SET quote=admin_preview_reservation_change(booking_id,'2098-06-01','10:00','2098-06-02','11:00','extend');
SELECT is((SELECT (quote->>'additional_charges_cents')::integer FROM schedule_fixture),12000,'Same-day one-hour extension crosses a started 24-hour day');
SELECT is((SELECT (quote->>'extension_hours')::numeric::integer FROM schedule_fixture),1,'Exact extension hours previewed');
SELECT throws_like('SELECT admin_save_reservation_change(booking_id,''2098-06-01'',''10:00'',''2098-06-02'',''11:00'',''extend'',''Synthetic extension reason'',quote||''{"additional_charges_cents":1}''::jsonb,request_id) FROM schedule_fixture','%pricing changed%','Client cannot change reviewed price');
UPDATE schedule_fixture SET result=admin_save_reservation_change(booking_id,'2098-06-01','10:00','2098-06-02','11:00','extend','Synthetic extension reason',quote,request_id);
SELECT is((SELECT dropoff_time FROM bookings WHERE id=(SELECT booking_id FROM schedule_fixture)),time '11:00','Same existing reservation is extended');
SELECT is((SELECT grand_total_cents FROM bookings WHERE id=(SELECT booking_id FROM schedule_fixture)),12000,'Original checkout amount unchanged');
SELECT is((SELECT admin_get_reservation_changes(booking_id)->>'updated_total_cents' FROM schedule_fixture),'24000','Updated total includes unpaid additional charge');
SELECT is((SELECT admin_get_reservation_changes(booking_id)->>'outstanding_balance_cents' FROM schedule_fixture),'12000','Extension remains unpaid');
SELECT is((SELECT admin_save_reservation_change(booking_id,'2098-06-01','10:00','2098-06-02','11:00','extend','Synthetic extension reason',quote,request_id)->>'already_saved' FROM schedule_fixture),'true','Retry does not duplicate extension or charge');
SELECT is((SELECT count(*)::integer FROM admin_reservation_changes WHERE booking_id=(SELECT booking_id FROM schedule_fixture)),1,'One immutable amendment');
RESET ROLE;
SELECT is((SELECT to_jsonb(p) FROM booking_payments p WHERE id=(SELECT payment_id FROM schedule_fixture)),(SELECT original_payment FROM schedule_fixture),'Entire original payment record preserved');
SELECT is((SELECT to_jsonb(d) FROM booking_security_deposits d WHERE rental_payment_id=(SELECT payment_id FROM schedule_fixture)),(SELECT original_deposit FROM schedule_fixture),'Entire original security-deposit record preserved');
SELECT is((SELECT reserved_span FROM vehicle_payment_claims WHERE booking_id=(SELECT booking_id FROM schedule_fixture)),tsrange('2098-06-01 10:00','2098-06-02 11:00','[)'),'Availability claim follows operative dates');
SELECT ok(EXISTS(SELECT 1 FROM rental_agreement_revisions r JOIN rental_agreement_current_revisions c ON c.revision_id=r.id WHERE c.booking_id=(SELECT booking_id FROM schedule_fixture) AND r.revision_number=2),'Missing current revision bootstrapped from accepted original and amended immutably');
SELECT ok(EXISTS(SELECT 1 FROM rental_extension_periods WHERE reservation_change_id=(SELECT (result->>'change_id')::uuid FROM schedule_fixture) AND payment_status='payment_due' AND paid_at IS NULL),'Existing renewal payment flow receives an unpaid obligation');
SELECT throws_like('UPDATE admin_reservation_changes SET reason=''Rewrite history''','%immutable%','Audit cannot be overwritten');
-- Preview/save race: a blocked period added AFTER preview must stop the save.
SET LOCAL ROLE authenticated;
UPDATE schedule_fixture SET quote=admin_preview_reservation_change(booking_id,'2098-06-01','10:00','2098-06-04','10:00','extend'),request_id=gen_random_uuid();
RESET ROLE;
INSERT INTO vehicle_blocked_periods(vehicle_id,host_profile_id,start_at,end_at,reason) SELECT f.vehicle_id,v.host_profile_id,'2098-06-03 00:00','2098-06-04 00:00','Synthetic conflict' FROM schedule_fixture f JOIN vehicles v ON v.id=f.vehicle_id;
SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT admin_save_reservation_change(booking_id,''2098-06-01'',''10:00'',''2098-06-04'',''10:00'',''extend'',''Synthetic conflict reason'',quote,request_id) FROM schedule_fixture','%blocked period%','Save rechecks blocked periods');
RESET ROLE;
DELETE FROM vehicle_blocked_periods WHERE vehicle_id=(SELECT vehicle_id FROM schedule_fixture);
SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT admin_preview_reservation_change(booking_id,''2098-06-01'',''10:00'',''2098-05-31'',''10:00'',''edit'') FROM schedule_fixture','%minimum rental%','Invalid return rejected');
UPDATE schedule_fixture SET quote=admin_preview_reservation_change(booking_id,'2098-06-01','09:00','2098-06-02','10:00','edit'),request_id=gen_random_uuid();
SELECT is((SELECT (quote->>'adjustment_cents')::integer FROM schedule_fixture),0,'Same billable duration edit has no extra charge');
SELECT lives_ok('SELECT admin_save_reservation_change(booking_id,''2098-06-01'',''09:00'',''2098-06-02'',''10:00'',''edit'',''Synthetic pickup correction'',quote,request_id) FROM schedule_fixture','Admin can edit pickup before trip starts');
SELECT is((SELECT pickup_time FROM bookings WHERE id=(SELECT booking_id FROM schedule_fixture)),time '09:00','Edited pickup is visible immediately');
SELECT is((SELECT count(*)::integer FROM booking_audit_events WHERE booking_id=(SELECT booking_id FROM schedule_fixture) AND action_type IN ('reservation_edit','reservation_extend')),2,'Both actions audited');
RESET ROLE;

-- A separate reservation on the same vehicle blocks a later extension.
INSERT INTO bookings(renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency)
SELECT renter_profile_id,host_profile_id,vehicle_id,'2098-06-03','2098-06-04','10:00','10:00','confirmed',10000,1200,800,12000,'usd' FROM bookings WHERE id=(SELECT booking_id FROM schedule_fixture);
SET LOCAL ROLE authenticated;
SELECT throws_like('SELECT admin_preview_reservation_change(booking_id,''2098-06-01'',''09:00'',''2098-06-03'',''11:00'',''extend'') FROM schedule_fixture','%overlap%','Overlapping existing reservation rejected');
UPDATE schedule_fixture SET quote=admin_preview_reservation_change(booking_id,'2098-06-01','09:00','2098-06-02','09:00','edit'),request_id=gen_random_uuid();
SELECT is((SELECT (quote->>'credit_cents')::integer FROM schedule_fixture),12000,'Shortening recalculates a credit without refunding a card');
SELECT lives_ok('SELECT admin_save_reservation_change(booking_id,''2098-06-01'',''09:00'',''2098-06-02'',''09:00'',''edit'',''Synthetic shorter duration'',quote,request_id) FROM schedule_fixture','Shortening saves same reservation');
SELECT is((SELECT admin_get_reservation_changes(booking_id)->>'outstanding_balance_cents' FROM schedule_fixture),'0','Credit offsets earlier unpaid extension balance');
SELECT throws_like('INSERT INTO admin_reservation_changes(booking_id,action,before_state,after_state,quote,adjustment_cents,reason,actor_profile_id,request_id) VALUES(gen_random_uuid(),''edit'',''{}'',''{}'',''{}'',0,''Forged change'',gen_random_uuid(),gen_random_uuid())','%permission denied%','Clients cannot forge the guard authorization record');
RESET ROLE;
SELECT is((SELECT to_jsonb(d) FROM booking_security_deposits d WHERE rental_payment_id=(SELECT payment_id FROM schedule_fixture)),(SELECT original_deposit FROM schedule_fixture),'Deposit still unchanged after edit and credit');
SELECT is((SELECT to_jsonb(p) FROM booking_payments p WHERE id=(SELECT payment_id FROM schedule_fixture)),(SELECT original_payment FROM schedule_fixture),'Original payment unchanged after edit and credit');
