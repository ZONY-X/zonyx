SELECT no_plan();
CREATE TEMP TABLE operative_fixture(booking uuid,period uuid,plan uuid,revision uuid,agreement jsonb,prior_hash text);
DO $$ DECLARE b public.bookings%ROWTYPE; actor uuid; result jsonb; plan uuid;rev public.rental_agreement_revisions%ROWTYPE;pid uuid; aid uuid:=gen_random_uuid();cid uuid:=gen_random_uuid(); BEGIN
 SELECT * INTO b FROM bookings WHERE reservation_number='ZNX-000150';SELECT user_id INTO actor FROM profiles WHERE is_admin LIMIT 1;PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 result:=admin_schedule_rental_extension(b.id,b.end_date+92,'10:00',158400,false,'Synthetic operative display validation');plan:=(result->>'plan_id')::uuid;PERFORM admin_activate_rental_extension(plan);
 SELECT r.* INTO rev FROM rental_agreement_current_revisions c JOIN rental_agreement_revisions r ON r.id=c.revision_id WHERE c.booking_id=b.id;SELECT id INTO pid FROM rental_extension_periods WHERE extension_plan_id=plan ORDER BY period_number LIMIT 1;
 INSERT INTO square_renewal_payment_attempts(id,period_id,booking_id,generation,amount_cents,currency,environment,location_id,state,provider_payment_id,settled_at) VALUES(aid,pid,b.id,1,158400,'usd','live','synthetic','paid','synthetic-payment',now());
 UPDATE rental_extension_periods SET payment_status='paid',square_payment_id='synthetic-payment',paid_at=now() WHERE id=pid;
 INSERT INTO square_renewal_agreement_acceptances(id,booking_id,period_id,submission_id,version_id,agreement_version,master_hash,source_revision_id,source_revision_hash,document_hash,rendered_text,consent_text,payer_name,payer_email,accepted_user_agent)
 SELECT cid,b.id,pid,gen_random_uuid(),id,version,content_hash,rev.id,rev.document_hash,encode(extensions.digest('Synthetic accepted renewal','sha256'),'hex'),'Synthetic accepted renewal','I accept the Rental Agreement.','Fixture Guest','guest@example.invalid','fixture' FROM rental_agreement_versions WHERE version='1.6';
 INSERT INTO square_checkout_authorizations(attempt_id,submission_id,booking_id,payer_given_name,payer_family_name,payer_email,postal_code,country,terms_version,terms_text,terms_sha256,terms_context,storage_consent,future_charge_consent) VALUES(aid,gen_random_uuid(),b.id,'Fixture','Guest','guest@example.invalid','10003','US','zonyx-square-cof-v1',repeat('terms ',30),encode(extensions.digest(repeat('terms ',30),'sha256'),'hex'),jsonb_build_object('rental_agreement_acceptance_id',cid),true,true);
 INSERT INTO operative_fixture VALUES(b.id,pid,plan,rev.id,get_booking_rental_agreement(b.id),rev.document_hash);
END $$;
SELECT is((SELECT agreement#>>'{operative_renewal,projection_version}' FROM operative_fixture),'1','authorized read returns operative projection');
SELECT is((SELECT agreement#>>'{operative_renewal,extension_start_date}' FROM operative_fixture),'2026-10-21','renewal begins at extension period, not original pickup');
SELECT is((SELECT agreement#>>'{operative_renewal,return_time}' FROM operative_fixture),'10:00:00','operative return time uses revision');
SELECT is((SELECT agreement#>>'{operative_renewal,periods,0,amount_cents}' FROM operative_fixture),'158400','renewal amount from period and verified Square payment');
SELECT is((SELECT agreement#>>'{operative_renewal,periods,0,verified_square_payment_id}' FROM operative_fixture),'synthetic-payment','verified payment bound to exact period');
SELECT is((SELECT agreement#>>'{operative_renewal,periods,1,payment_status}' FROM operative_fixture),'scheduled','later periods not marked paid');
SELECT is((SELECT agreement#>>'{operative_renewal,accepted_renewal,version}' FROM operative_fixture),'1.6','recorded renewal acceptance is source for legal terms');
SELECT is((SELECT agreement->>'document_hash' FROM operative_fixture),(SELECT prior_hash FROM operative_fixture),'original revision hash not replaced by display hash');
SELECT ok((SELECT (agreement#>'{operative_renewal,extension_start_time}')='null'::jsonb FROM operative_fixture),'no unrecorded renewal start time invented');
SELECT is((SELECT agreement#>>'{operative_renewal,original_amount_cents}' FROM operative_fixture),'12096','original amount remains separate historical context');
DO $$ BEGIN PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);END $$;
SELECT throws_like('SELECT get_booking_rental_agreement(booking) FROM operative_fixture','%Not authorized%','anonymous caller cannot inspect private agreement');
