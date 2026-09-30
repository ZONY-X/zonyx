-- Run after 20260930160000. The validation runner supplies BEGIN/ROLLBACK.
DO $test$
DECLARE admin_user uuid; accepted public.booking_rental_agreements%ROWTYPE; payload jsonb; before_fingerprint text; after_fingerprint text;
BEGIN
 SELECT p.user_id INTO admin_user FROM public.profiles p WHERE p.is_admin ORDER BY p.created_at LIMIT 1;
 SELECT a.* INTO accepted FROM public.booking_rental_agreements a JOIN public.profiles p ON p.id=a.guest_profile_id WHERE a.accepted_at IS NOT NULL AND NOT p.is_admin ORDER BY a.accepted_at LIMIT 1;
 IF admin_user IS NULL OR accepted.id IS NULL THEN RAISE EXCEPTION 'Required Admin/agreement fixtures unavailable.'; END IF;
 SELECT md5(string_agg(id::text||':'||master_version||':'||accepted_at::text||':'||document_hash||':'||md5(rendered_text),'|' ORDER BY id)) INTO before_fingerprint FROM public.booking_rental_agreements WHERE accepted_at IS NOT NULL;
 PERFORM set_config('request.jwt.claim.sub',admin_user::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated;
 payload:=public.get_booking_rental_agreement(accepted.booking_id);
 RESET ROLE;
 IF payload->>'rendered_text'<>accepted.rendered_text OR payload->>'document_hash'<>accepted.document_hash THEN RAISE EXCEPTION 'Retrieval did not return the immutable executed snapshot.'; END IF;
 IF payload->>'accepted_ip'<>accepted.accepted_ip::text OR payload->>'accepted_user_agent' IS DISTINCT FROM accepted.accepted_user_agent THEN RAISE EXCEPTION 'Acceptance audit metadata is incomplete.'; END IF;
 IF payload->>'guest_profile_id'<>accepted.guest_profile_id::text OR payload->>'guest_auth_user_id'<>accepted.guest_auth_user_id::text THEN RAISE EXCEPTION 'Accepted identity evidence is incomplete.'; END IF;
 IF encode(extensions.digest(payload->>'rendered_text','sha256'),'hex')<>payload->>'document_hash' THEN RAISE EXCEPTION 'Executed snapshot hash failed verification.'; END IF;
 IF payload->>'signature_method'<>'authenticated_electronic_acceptance' OR NOT(payload->>'electronic_acceptance_recorded')::boolean THEN RAISE EXCEPTION 'Electronic acceptance evidence is missing.'; END IF;
 IF NOT(payload->>'audit_metadata_visible')::boolean THEN RAISE EXCEPTION 'Admin audit evidence was not exposed.'; END IF;
 PERFORM set_config('request.jwt.claim.sub',accepted.guest_auth_user_id::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated;
 payload:=public.get_booking_rental_agreement(accepted.booking_id);
 RESET ROLE;
 IF payload->>'rendered_text'<>accepted.rendered_text OR payload->>'document_hash'<>accepted.document_hash THEN RAISE EXCEPTION 'Guest did not receive the exact executed snapshot.'; END IF;
 IF (payload->>'audit_metadata_visible')::boolean OR payload->>'accepted_ip' IS NOT NULL OR payload->>'accepted_user_agent' IS NOT NULL OR payload->>'guest_auth_user_id' IS NOT NULL THEN RAISE EXCEPTION 'Internal acceptance audit metadata leaked to non-Admin participant.'; END IF;
 SELECT md5(string_agg(id::text||':'||master_version||':'||accepted_at::text||':'||document_hash||':'||md5(rendered_text),'|' ORDER BY id)) INTO after_fingerprint FROM public.booking_rental_agreements WHERE accepted_at IS NOT NULL;
 IF before_fingerprint<>after_fingerprint THEN RAISE EXCEPTION 'Evidence retrieval mutated accepted agreements.'; END IF;
END $test$;
SELECT 'PASS: Admin retrieves exact immutable executed agreement evidence' AS result;