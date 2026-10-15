SELECT no_plan();
SELECT is((SELECT version FROM rental_agreement_versions WHERE id='6deae437-4b73-43a0-b60e-0894ce7d57f1'),'1.5','v1.5 master published');
SELECT ok((SELECT canonical_body LIKE '%For reservations of 60 days or longer%' AND canonical_body LIKE '%one and one-half (1.5) months%' AND canonical_body LIKE '%whichever is lower%' AND canonical_body LIKE '%replacement rental revenue%' FROM rental_agreement_versions WHERE version='1.5'),'duration, multiplier, damages cap and mitigation included');
SELECT is((SELECT content_hash FROM rental_agreement_versions WHERE version='1.4'),'2d941427e7d1c27cd744d3785a2bca40f2200e327e0963e5d5558ab95fec9be3','historical master unchanged');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.payment_rental_addendum_acceptances'::regclass),'addendum evidence RLS enabled');
SELECT ok(NOT has_table_privilege('anon','public.payment_rental_addendum_acceptances','SELECT') AND NOT has_table_privilege('authenticated','public.payment_rental_addendum_acceptances','INSERT'),'public cannot read or forge addendum evidence');
CREATE TEMP TABLE historical_agreement_baseline AS SELECT id,document_hash,rendered_text,accepted_at FROM booking_rental_agreements WHERE accepted_at IS NOT NULL;
INSERT INTO payment_rental_addendum_acceptances(booking_id,agreement_id,version_id,agreement_version,source_document_hash,document_hash,rendered_text,consent_text,guest_auth_user_id,accepted_ip,accepted_user_agent)
SELECT booking_id,id,'6deae437-4b73-43a0-b60e-0894ce7d57f1','1.5',document_hash,encode(extensions.digest('Synthetic separately accepted addendum','sha256'),'hex'),'Synthetic separately accepted addendum','Synthetic explicit acceptance',guest_auth_user_id,'192.0.2.1','Synthetic local test' FROM booking_rental_agreements WHERE accepted_at IS NOT NULL LIMIT 1;
SELECT is((SELECT count(*)::integer FROM payment_rental_addendum_acceptances),1,'separate acceptance persists without rewriting signed agreement');
SELECT ok((SELECT accepted_at IS NOT NULL AND accepted_ip IS NOT NULL AND guest_auth_user_id IS NOT NULL AND booking_id IS NOT NULL FROM payment_rental_addendum_acceptances),'timestamp, guest, reservation and network evidence recorded');
DO $$ BEGIN
 BEGIN
  UPDATE payment_rental_addendum_acceptances SET rendered_text='overwrite';
  RAISE EXCEPTION 'Mutation unexpectedly succeeded';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Mutation unexpectedly succeeded' THEN RAISE; END IF;
 END;
END $$;
SELECT is((SELECT rendered_text FROM payment_rental_addendum_acceptances),'Synthetic separately accepted addendum','acceptance bytes immutable');
SELECT ok(NOT EXISTS(SELECT 1 FROM historical_agreement_baseline old JOIN booking_rental_agreements a USING(id) WHERE old.document_hash<>a.document_hash OR old.rendered_text<>a.rendered_text OR old.accepted_at<>a.accepted_at),'all historical signed documents and acceptance timestamps preserved');
SELECT ok((SELECT prosrc LIKE '%master_version <> ''1.5''%' FROM pg_proc WHERE oid='public.accept_prepared_rental_agreement(uuid,text,boolean,boolean,uuid,inet,text)'::regprocedure),'unsigned acceptance rejects obsolete versions');
SELECT ok((SELECT prosrc LIKE '%6deae437-4b73-43a0-b60e-0894ce7d57f1%' FROM pg_proc WHERE oid='public.prepare_square_cof_checkout(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text)'::regprocedure),'renewal dispatch requires current agreement acceptance');
SELECT ok((SELECT prosrc LIKE '%NEW.master_version NOT IN (''1.4'',''1.5'')%' FROM pg_proc WHERE oid='public.validate_additional_drivers_in_accepted_snapshot()'::regprocedure),'existing driver snapshot validation also applies to v1.5');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.prepare_square_cof_checkout('renewal','synthetic-nonexistent-token',gen_random_uuid(),'{"givenName":"Synthetic","familyName":"Guest","email":"test@example.invalid"}','synthetic','synthetic','{}',true,true,'synthetic-location');
  RAISE EXCEPTION 'Missing consent unexpectedly passed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Explicit Rental Agreement acceptance is required before payment.' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SELECT pass('missing renewal agreement acceptance rejected before payment preparation');
