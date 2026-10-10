BEGIN;

DO $$
DECLARE booking uuid; original_hash text; current_hash text; current_revision integer; drivers jsonb; accepted_before timestamptz;
BEGIN
 SELECT b.id,a.document_hash,a.accepted_at INTO booking,original_hash,accepted_before FROM public.bookings b JOIN public.booking_rental_agreements a ON a.booking_id=b.id WHERE b.reservation_number='ZNX-000150';
 IF booking IS NULL THEN RAISE EXCEPTION 'ZNX-000150 fixture unavailable'; END IF;
 SELECT r.document_hash,r.revision_number,r.operative_state->'additional_authorized_drivers' INTO current_hash,current_revision,drivers FROM public.rental_agreement_current_revisions p JOIN public.rental_agreement_revisions r ON r.id=p.revision_id WHERE p.booking_id=booking;
 IF original_hash<>(SELECT encode(extensions.digest(a.rendered_text,'sha256'),'hex') FROM public.booking_rental_agreements a WHERE a.booking_id=booking) THEN RAISE EXCEPTION 'Original hash changed'; END IF;
 IF current_revision<>3 THEN RAISE EXCEPTION 'Normalized corrected revision is not current'; END IF;
 IF NOT drivers @> '[{"legal_name":"Alejandra Ponce Gutierrez","role":"additional"}]'::jsonb THEN RAISE EXCEPTION 'Alejandra missing from operative state'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rental_agreement_revisions WHERE booking_id=booking AND revision_number=1 AND document_hash=original_hash) THEN RAISE EXCEPTION 'Original revision not preserved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rental_agreement_revisions r JOIN public.booking_rental_agreement_corrections c ON c.id=r.source_correction_id WHERE r.booking_id=booking AND r.revision_number=2 AND r.document_hash=c.corrected_document_hash) THEN RAISE EXCEPTION 'Prior corrected revision not preserved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rental_agreement_revisions WHERE booking_id=booking AND revision_number=3 AND rendered_text LIKE '%Primary Authorized Driver: Federico Flores Navarro%' AND rendered_text LIKE '%Additional Authorized Driver: Alejandra Ponce Gutierrez%') THEN RAISE EXCEPTION 'Current operative driver labels are incomplete'; END IF;
 IF (SELECT accepted_at FROM public.booking_rental_agreements WHERE booking_id=booking) IS DISTINCT FROM accepted_before THEN RAISE EXCEPTION 'Acceptance evidence changed'; END IF;
END $$;

DO $$
DECLARE revision_id uuid;
BEGIN
 SELECT id INTO revision_id FROM public.rental_agreement_revisions LIMIT 1;
 BEGIN UPDATE public.rental_agreement_revisions SET reason='illegal mutation' WHERE id=revision_id; RAISE EXCEPTION 'Revision mutation unexpectedly succeeded'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Revision mutation unexpectedly succeeded' THEN RAISE; END IF; END;
 BEGIN DELETE FROM public.rental_agreement_revisions WHERE id=revision_id; RAISE EXCEPTION 'Revision delete unexpectedly succeeded'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Revision delete unexpectedly succeeded' THEN RAISE; END IF; END;
END $$;

DO $lifecycle$
DECLARE
  v_booking_id uuid; admin_auth uuid; guest_auth uuid; original_booking_count bigint;
  original_accepted_at timestamptz; original_hash text; first_result jsonb; second_result jsonb;
  proposal_result jsonb; accepted_result jsonb; retry_result jsonb; proposal_id uuid;
  v_revision_id uuid; proposal_hash text; current_number integer; current_names text[];
BEGIN
  SELECT b.id,a.accepted_at,a.document_hash,p.user_id INTO v_booking_id,original_accepted_at,original_hash,guest_auth
  FROM public.bookings b JOIN public.booking_rental_agreements a ON a.booking_id=b.id JOIN public.profiles p ON p.id=b.renter_profile_id
  WHERE b.reservation_number='ZNX-000150';
  SELECT user_id INTO admin_auth FROM public.profiles WHERE is_admin ORDER BY created_at LIMIT 1;
  SELECT count(*) INTO original_booking_count FROM public.bookings;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_auth,'role','authenticated')::text,true);

  first_result:=public.admin_amend_rental_agreement(v_booking_id,ARRAY['Alejandra Ponce Gutierrez','Second Test Driver'],date '2026-10-21',time '11:30','Miami International Airport','Coconut Grove','pickup','None',now(),'Rollback test multiple Additional Authorized Drivers');
  IF first_result->>'kind'<>'operational' THEN RAISE EXCEPTION 'Driver amendment was not operational'; END IF;
  SELECT r.revision_number,array(SELECT x->>'legal_name' FROM jsonb_array_elements(r.operative_state->'additional_authorized_drivers') x ORDER BY x->>'legal_name')
  INTO current_number,current_names FROM public.rental_agreement_current_revisions c JOIN public.rental_agreement_revisions r ON r.id=c.revision_id WHERE c.booking_id=v_booking_id;
  IF current_names<>ARRAY['Alejandra Ponce Gutierrez','Second Test Driver'] THEN RAISE EXCEPTION 'Multiple drivers did not survive operative revision: %',current_names; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rental_agreement_revisions r WHERE r.booking_id=v_booking_id AND r.revision_number=current_number AND r.rendered_text LIKE '%Alejandra Ponce Gutierrez%' AND r.rendered_text LIKE '%Second Test Driver%' AND encode(extensions.digest(r.rendered_text,'sha256'),'hex')=r.document_hash) THEN RAISE EXCEPTION 'Multiple drivers missing from exact stored document'; END IF;

  second_result:=public.admin_amend_rental_agreement(v_booking_id,ARRAY['Alejandra Ponce Gutierrez'],date '2026-10-21',time '11:30','Miami International Airport','Coconut Grove','pickup','Curbside handoff confirmed',now(),'Rollback test designated operational term');
  IF second_result->>'kind'<>'operational' THEN RAISE EXCEPTION 'Operational term unexpectedly required acceptance'; END IF;

  proposal_result:=public.admin_amend_rental_agreement(v_booking_id,ARRAY['Alejandra Ponce Gutierrez'],date '2026-10-22',time '11:30','Miami International Airport','Coconut Grove','pickup','Curbside handoff confirmed',now(),'Rollback test rental return extension');
  IF proposal_result->>'kind'<>'material' OR NOT (proposal_result->>'requires_customer_acceptance')::boolean THEN RAISE EXCEPTION 'Extension was not held for Guest acceptance'; END IF;
  proposal_id:=(proposal_result->>'proposal_id')::uuid;
  SELECT document_hash INTO proposal_hash FROM public.rental_agreement_amendment_proposals WHERE id=proposal_id;
  IF (SELECT end_date FROM public.bookings WHERE id=v_booking_id)<>date '2026-10-21' THEN RAISE EXCEPTION 'Pending extension changed booking before acceptance'; END IF;

  PERFORM set_config('request.jwt.claims',json_build_object('sub',guest_auth,'role','authenticated')::text,true);
  accepted_result:=public.accept_rental_agreement_amendment(proposal_id,proposal_hash,'127.0.0.1','rollback-test-agent');
  retry_result:=public.accept_rental_agreement_amendment(proposal_id,proposal_hash,'127.0.0.1','rollback-test-agent');
  v_revision_id:=(accepted_result->>'revision_id')::uuid;
  IF (retry_result->>'revision_id')::uuid<>v_revision_id OR NOT (retry_result->>'already_accepted')::boolean THEN RAISE EXCEPTION 'Acceptance retry was not idempotent'; END IF;
  IF (SELECT count(*) FROM public.rental_agreement_revisions WHERE source_proposal_id=proposal_id)<>1 THEN RAISE EXCEPTION 'Duplicate accepted amendment revision'; END IF;
  IF (SELECT c.revision_id FROM public.rental_agreement_current_revisions c WHERE c.booking_id=v_booking_id)<>v_revision_id THEN RAISE EXCEPTION 'Accepted material amendment is not current'; END IF;
  IF (SELECT end_date FROM public.bookings WHERE id=v_booking_id)<>date '2026-10-22' THEN RAISE EXCEPTION 'Accepted extension did not update operational booking'; END IF;
  IF (SELECT count(*) FROM public.bookings)<>original_booking_count THEN RAISE EXCEPTION 'Amendment created another booking'; END IF;
  IF (SELECT accepted_at FROM public.booking_rental_agreements WHERE booking_id=v_booking_id) IS DISTINCT FROM original_accepted_at OR (SELECT document_hash FROM public.booking_rental_agreements WHERE booking_id=v_booking_id)<>original_hash THEN RAISE EXCEPTION 'Original accepted agreement evidence changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rental_agreement_amendment_events WHERE revision_id=v_revision_id AND event_type='customer_accepted' AND actor_auth_user_id=guest_auth AND ip_address='127.0.0.1') THEN RAISE EXCEPTION 'Customer acceptance audit evidence missing'; END IF;
END $lifecycle$;

SELECT 'PASS: immutable bootstrap, drivers, material consent, retry idempotency, exact hashes, and accepted evidence preservation' AS result;
ROLLBACK;
