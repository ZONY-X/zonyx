-- Run after the v1.4 migrations. The surrounding test runner supplies BEGIN/ROLLBACK.
DO $assert_catalog$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.reservation_agreement_contexts'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.reservation_additional_authorized_drivers'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.reservation_agreement_context_audit'::regclass) THEN
    RAISE EXCEPTION 'Trusted reservation tables must have RLS enabled.';
  END IF;
  IF has_table_privilege('authenticated','public.reservation_agreement_contexts','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated','public.reservation_additional_authorized_drivers','SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated','public.reservation_agreement_context_audit','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Authenticated clients must not have direct trusted-table privileges.';
  END IF;
  IF NOT has_function_privilege('authenticated','public.admin_create_reservation_agreement_context(text,uuid,date,time without time zone,date,time without time zone,text,text,jsonb,jsonb,text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.claim_reservation_agreement_context(uuid,uuid,uuid,uuid,date,time without time zone,date,time without time zone,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Trusted-context function ACLs are incorrect.';
  END IF;
END $assert_catalog$;

SET LOCAL ROLE authenticated;
DO $assert_guest_denied$
BEGIN
  BEGIN
    PERFORM 1 FROM public.reservation_agreement_contexts LIMIT 1;
    RAISE EXCEPTION 'Guest direct trusted-context read unexpectedly succeeded.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.admin_create_reservation_agreement_context('guest@example.com',gen_random_uuid(),'2039-09-21','10:00','2039-10-21','10:00','Miami Beach','Brickell',NULL,'[]','Guest assertion','none','Unauthorized attempt');
    RAISE EXCEPTION 'Guest trusted-context creation unexpectedly succeeded.';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'Authoritative Admin required.' THEN RAISE; END IF;
  END;
END $assert_guest_denied$;
RESET ROLE;

CREATE TEMP TABLE v14_admin_rpc_input AS
SELECT
  (SELECT p.user_id FROM public.profiles p WHERE p.is_admin ORDER BY p.created_at LIMIT 1) AS admin_user_id,
  (SELECT p.email FROM public.profiles p JOIN public.driver_eligibility d ON d.profile_id=p.id WHERE NULLIF(btrim(d.legal_name),'') IS NOT NULL ORDER BY p.created_at LIMIT 1) AS guest_email,
  (SELECT d.legal_name FROM public.profiles p JOIN public.driver_eligibility d ON d.profile_id=p.id WHERE NULLIF(btrim(d.legal_name),'') IS NOT NULL ORDER BY p.created_at LIMIT 1) AS guest_legal_name,
  (SELECT v.id FROM public.vehicles v ORDER BY v.created_at LIMIT 1) AS vehicle_id;
GRANT SELECT ON v14_admin_rpc_input TO authenticated;
DO $admin_fixture_check$
BEGIN
 IF EXISTS(SELECT 1 FROM v14_admin_rpc_input WHERE admin_user_id IS NULL OR guest_email IS NULL OR guest_legal_name IS NULL OR vehicle_id IS NULL) THEN RAISE EXCEPTION 'Admin RPC fixtures unavailable.'; END IF;
END $admin_fixture_check$;
SELECT set_config('request.jwt.claim.sub',(SELECT admin_user_id::text FROM v14_admin_rpc_input),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT * FROM public.admin_create_reservation_agreement_context(
  (SELECT guest_email FROM v14_admin_rpc_input),(SELECT vehicle_id FROM v14_admin_rpc_input),
  '2040-01-05','09:00','2040-01-06','09:00','Miami Beach','Brickell',
  jsonb_build_object('provider','CarInsuRent','product','Rental Vehicle Excess Protection','insured_primary_driver_name',(SELECT guest_legal_name FROM v14_admin_rpc_input),'policy_or_certificate_number','ADMIN-RPC-ROLLBACK','coverage_start_at','2040-01-05T08:00:00-05:00','coverage_end_at','2040-01-06T10:00:00-05:00','protection_limit_cents',50000,'rental_vehicle_excess_cents',50000,'currency','usd'),
  '[{"full_legal_name":"Admin Approved Driver","approval_status":"approved"}]'::jsonb,
  'Admin workflow rollback test','ADMIN-RPC-REF','Validate authorized Admin trusted-details workflow'
);
RESET ROLE;
DO $assert_admin_rpc$
DECLARE ctx public.reservation_agreement_contexts%ROWTYPE;
BEGIN
 SELECT * INTO ctx FROM public.reservation_agreement_contexts WHERE policy_or_certificate_number='ADMIN-RPC-ROLLBACK';
 IF NOT FOUND OR ctx.status<>'active' OR ctx.protection_verified_at IS NULL OR ctx.protection_provider<>'CarInsuRent' THEN RAISE EXCEPTION 'Authorized Admin trusted-context creation failed.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.reservation_additional_authorized_drivers WHERE reservation_context_id=ctx.id AND full_legal_name='Admin Approved Driver' AND approval_status='approved') THEN RAISE EXCEPTION 'Admin-approved Additional Authorized Driver was not persisted.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.reservation_agreement_context_audit WHERE reservation_context_id=ctx.id AND action='protection_verified')
    OR NOT EXISTS(SELECT 1 FROM public.reservation_agreement_context_audit WHERE reservation_context_id=ctx.id AND action='driver_approved') THEN RAISE EXCEPTION 'Admin workflow audit events are incomplete.'; END IF;
END $assert_admin_rpc$;

DO $fixtures$
DECLARE guest uuid; guest_user uuid; primary_name text; actor uuid; vehicle uuid; proposed uuid:='14000000-0000-4000-8000-000000000002'; context_id uuid:='14000000-0000-4000-8000-000000000003'; agreement_id uuid:='14000000-0000-4000-8000-000000000004'; host uuid;
BEGIN
 SELECT p.id,p.user_id,d.legal_name INTO guest,guest_user,primary_name FROM public.profiles p JOIN public.driver_eligibility d ON d.profile_id=p.id WHERE NULLIF(btrim(d.legal_name),'') IS NOT NULL ORDER BY p.created_at LIMIT 1;
 SELECT v.id,v.host_profile_id INTO vehicle,host FROM public.vehicles v ORDER BY v.created_at LIMIT 1;
 SELECT p.id INTO actor FROM public.profiles p WHERE p.is_admin ORDER BY p.created_at LIMIT 1;
 actor:=COALESCE(actor,guest);
 IF guest IS NULL OR guest_user IS NULL OR vehicle IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'Production-schema fixtures unavailable.'; END IF;
 INSERT INTO public.reservation_agreement_contexts(id,proposed_booking_id,guest_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,reservation_fingerprint,protection_provider,protection_product,insured_primary_driver_name,policy_or_certificate_number,coverage_start_at,coverage_end_at,protection_limit_cents,rental_vehicle_excess_cents,protection_currency,protection_verified_at,administrative_source,administrative_source_reference,administrative_note,created_by_profile_id)
 VALUES(context_id,proposed,guest,vehicle,'2039-09-21','2039-10-21','10:00','10:00','Miami Beach','Brickell',encode(extensions.digest(concat_ws('|',guest,vehicle,'2039-09-21'::date,'10:00'::time,'2039-10-21'::date,'10:00'::time,'Miami Beach','Brickell'),'sha256'),'hex'),'CarInsuRent','Rental Vehicle Excess Protection',primary_name,'TEST-CERTIFICATE','2039-09-21 09:00 America/New_York','2039-10-21 11:00 America/New_York',50000,50000,'usd',now(),'Rollback test','TEST-REF','Rollback-only fixture',actor);
 INSERT INTO public.reservation_additional_authorized_drivers(id,reservation_context_id,full_legal_name,approval_status,approved_at,approved_by_profile_id,administrative_source)
 VALUES('14000000-0000-4000-8000-000000000005',context_id,'Test Additional Driver','approved',now(),actor,'Rollback test');
 INSERT INTO public.reservation_agreement_context_audit(reservation_context_id,action,actor_profile_id,reason,after_state) VALUES(context_id,'created',actor,'Rollback-only fixture','{}');
 INSERT INTO public.booking_rental_agreements(id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at,reservation_context_id)
 VALUES(agreement_id,proposed,'55f3eb31-7e3b-4ad7-bce3-8f1cc5bedc96','1.4',guest,guest_user,
 jsonb_build_object('primary_authorized_driver',jsonb_build_object('profile_id',guest,'legal_name',primary_name,'role','primary'),
 'additional_authorized_drivers',jsonb_build_array(jsonb_build_object('record_id','14000000-0000-4000-8000-000000000005','legal_name','Test Additional Driver','role','additional','approved_at',now()))),
 'Primary Authorized Driver: '||primary_name||chr(10)||'Additional Authorized Driver(s): Test Additional Driver',
 encode(extensions.digest('Primary Authorized Driver: '||primary_name||chr(10)||'Additional Authorized Driver(s): Test Additional Driver','sha256'),'hex'),
 'v14-trusted-context-rollback',now()+interval '1 hour',context_id);
END $fixtures$;
CREATE TEMP TABLE v14_expected_snapshot AS
SELECT rendered_text,document_hash FROM public.booking_rental_agreements
WHERE id='14000000-0000-4000-8000-000000000004';

SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.claim_reservation_agreement_context('14000000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000004',(SELECT guest_profile_id FROM public.reservation_agreement_contexts WHERE id='14000000-0000-4000-8000-000000000003'),(SELECT vehicle_id FROM public.reservation_agreement_contexts WHERE id='14000000-0000-4000-8000-000000000003'),'2039-09-21','10:00','2039-10-21','10:00','Miami Beach','Brickell');

DO $accept$
DECLARE ctx public.reservation_agreement_contexts%ROWTYPE; host uuid;
BEGIN
 SELECT * INTO ctx FROM public.reservation_agreement_contexts WHERE id='14000000-0000-4000-8000-000000000003';
 SELECT host_profile_id INTO host FROM public.vehicles WHERE id=ctx.vehicle_id;
 IF ctx.status<>'prepared' OR ctx.prepared_agreement_id<>'14000000-0000-4000-8000-000000000004' THEN RAISE EXCEPTION 'Atomic context claim failed.'; END IF;
 INSERT INTO public.bookings(id,reservation_number,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_location,dropoff_location,pickup_time,dropoff_time,trip_status,currency)
 VALUES(ctx.proposed_booking_id,'V14-TRUSTED-ROLLBACK',ctx.guest_profile_id,host,ctx.vehicle_id,ctx.start_date,ctx.end_date,ctx.pickup_location,ctx.dropoff_location,ctx.pickup_time,ctx.dropoff_time,'pending_payment','usd');
 UPDATE public.booking_rental_agreements SET booking_id=ctx.proposed_booking_id,accepted_at=now(),accepted_ip='127.0.0.1',accepted_user_agent='v1.4 rollback test' WHERE id=ctx.prepared_agreement_id;
 SELECT * INTO ctx FROM public.reservation_agreement_contexts WHERE id=ctx.id;
 IF ctx.status<>'accepted' OR ctx.booking_id<>ctx.proposed_booking_id OR ctx.accepted_at IS NULL THEN RAISE EXCEPTION 'Acceptance-time context binding failed.'; END IF;
END $accept$;

DO $immutability$
BEGIN
 BEGIN
  UPDATE public.reservation_agreement_context_audit SET reason='Illegal mutation' WHERE reservation_context_id='14000000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'Audit mutation unexpectedly succeeded.';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Reservation agreement context audit is immutable.' THEN RAISE; END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM public.booking_rental_agreements a JOIN v14_expected_snapshot e ON a.rendered_text=e.rendered_text AND a.document_hash=e.document_hash WHERE a.id='14000000-0000-4000-8000-000000000004' AND a.master_version='1.4') THEN RAISE EXCEPTION 'Accepted v1.4 snapshot changed.'; END IF;
END $immutability$;

SELECT 'PASS: v1.4 trusted context ACLs, claim, immutable snapshot, audit, and acceptance binding' AS result;
