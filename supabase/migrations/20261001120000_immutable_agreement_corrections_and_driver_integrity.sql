-- Immutable administrative corrections preserve the original customer-accepted agreement.
CREATE TABLE public.booking_rental_agreement_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agreement_id uuid NOT NULL UNIQUE REFERENCES public.booking_rental_agreements(id) ON DELETE RESTRICT,
 booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
 original_document_hash text NOT NULL CHECK(original_document_hash~'^[a-f0-9]{64}$'),
 corrected_document_hash text NOT NULL CHECK(corrected_document_hash~'^[a-f0-9]{64}$'),
 corrected_rendered_text text NOT NULL,
 correction_type text NOT NULL CHECK(correction_type='additional_authorized_driver_omission'),
 exact_correction text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>=5),
 actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 actor_type text NOT NULL CHECK(actor_type IN('admin','system_on_behalf_of_admin')),
 corrected_at timestamptz NOT NULL DEFAULT now(),
 customer_reaccepted boolean NOT NULL DEFAULT false CHECK(customer_reaccepted=false),
 CHECK(original_document_hash<>corrected_document_hash)
);
ALTER TABLE public.booking_rental_agreement_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_rental_agreement_corrections FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.booking_rental_agreement_corrections TO service_role;

CREATE FUNCTION public.prevent_agreement_correction_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Rental Agreement correction history is immutable.'; END $$;
CREATE TRIGGER prevent_agreement_correction_mutation BEFORE UPDATE OR DELETE ON public.booking_rental_agreement_corrections FOR EACH ROW EXECUTE FUNCTION public.prevent_agreement_correction_mutation();

CREATE FUNCTION public.validate_additional_drivers_in_accepted_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb; expected_names text[]; snapshot_names text[];
BEGIN
 IF NEW.accepted_at IS NULL OR OLD.accepted_at IS NOT NULL OR NEW.master_version<>'1.4' THEN RETURN NEW; END IF;
 IF NOT(NEW.trip_financial_summary ? 'primary_authorized_driver') OR NOT(NEW.trip_financial_summary ? 'additional_authorized_drivers') THEN RAISE EXCEPTION 'Rental Agreement driver snapshot is incomplete.'; END IF;
 IF position('Additional Authorized Driver(s): ' in NEW.rendered_text)=0 THEN RAISE EXCEPTION 'Additional Authorized Driver section is missing from the executed agreement snapshot.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.trip_financial_summary->'additional_authorized_drivers','[]')) LOOP
  IF NULLIF(btrim(item->>'legal_name'),'') IS NULL OR position(item->>'legal_name' in NEW.rendered_text)=0 THEN RAISE EXCEPTION 'Additional Authorized Driver is missing from the executed agreement snapshot.'; END IF;
 END LOOP;
 IF NEW.reservation_context_id IS NOT NULL THEN
  SELECT COALESCE(array_agg(d.full_legal_name ORDER BY d.approved_at,d.id),'{}') INTO expected_names FROM public.reservation_additional_authorized_drivers d WHERE d.reservation_context_id=NEW.reservation_context_id AND d.approval_status='approved';
  SELECT COALESCE(array_agg(x->>'legal_name' ORDER BY x->>'approved_at',x->>'record_id'),'{}') INTO snapshot_names FROM jsonb_array_elements(COALESCE(NEW.trip_financial_summary->'additional_authorized_drivers','[]')) x;
  IF expected_names<>snapshot_names THEN RAISE EXCEPTION 'Trusted Additional Authorized Drivers changed after agreement preparation.'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_additional_drivers_in_accepted_snapshot BEFORE UPDATE OF accepted_at ON public.booking_rental_agreements FOR EACH ROW EXECUTE FUNCTION public.validate_additional_drivers_in_accepted_snapshot();

CREATE OR REPLACE FUNCTION public.get_booking_rental_agreement(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; v public.rental_agreement_versions%ROWTYPE; c public.booking_rental_agreement_corrections%ROWTYPE; admin_view boolean; display_text text; display_hash text;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id; IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
 admin_view:=public.current_profile_is_admin();
 IF NOT(admin_view OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO a FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL; IF NOT FOUND THEN RAISE EXCEPTION 'Accepted Rental Agreement not found.'; END IF;
 SELECT * INTO v FROM public.rental_agreement_versions WHERE id=a.master_agreement_id; IF NOT FOUND THEN RAISE EXCEPTION 'Rental Agreement Master version is unavailable.'; END IF;
 IF admin_view THEN SELECT * INTO c FROM public.booking_rental_agreement_corrections WHERE agreement_id=a.id; END IF;
 display_text:=CASE WHEN admin_view AND c.id IS NOT NULL THEN c.corrected_rendered_text ELSE a.rendered_text END;
 display_hash:=CASE WHEN admin_view AND c.id IS NOT NULL THEN c.corrected_document_hash ELSE a.document_hash END;
 RETURN jsonb_build_object(
  'id',a.id,'booking_id',a.booking_id,'proposed_booking_id',a.proposed_booking_id,'reservation_number',b.reservation_number,
  'master_agreement_id',a.master_agreement_id,'master_version',a.master_version,'master_title',v.title,'master_content_hash',v.content_hash,'agreement_effective_at',v.effective_at,
  'guest_profile_id',CASE WHEN admin_view THEN a.guest_profile_id ELSE NULL END,'guest_auth_user_id',CASE WHEN admin_view THEN a.guest_auth_user_id ELSE NULL END,
  'prepared_at',CASE WHEN admin_view THEN a.prepared_at ELSE NULL END,'accepted_at',a.accepted_at,'accepted_ip',CASE WHEN admin_view THEN a.accepted_ip::text ELSE NULL END,'accepted_user_agent',CASE WHEN admin_view THEN a.accepted_user_agent ELSE NULL END,
  'document_hash',display_hash,'rendered_text',display_text,'trip_financial_summary',CASE WHEN admin_view AND c.id IS NOT NULL THEN a.trip_financial_summary||jsonb_build_object('administrative_correction_additional_authorized_drivers',jsonb_build_array(jsonb_build_object('legal_name','Alejandra Ponce Gutierrez','role','additional','customer_reaccepted',false))) ELSE a.trip_financial_summary END,
  'original_document_hash',a.document_hash,'original_rendered_text',CASE WHEN admin_view AND c.id IS NOT NULL THEN a.rendered_text ELSE NULL END,
  'correction',CASE WHEN admin_view AND c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'original_document_hash',c.original_document_hash,'corrected_document_hash',c.corrected_document_hash,'exact_correction',c.exact_correction,'reason',c.reason,'corrected_at',c.corrected_at,'actor_profile_id',c.actor_profile_id,'actor_type',c.actor_type,'customer_reaccepted',c.customer_reaccepted) ELSE NULL END,
  'electronic_acceptance_recorded',true,'signature_method','authenticated_electronic_acceptance','audit_metadata_visible',admin_view
 );
END $$;
REVOKE ALL ON FUNCTION public.get_booking_rental_agreement(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_booking_rental_agreement(uuid) TO authenticated;

-- One authorized correction for ZNX-000150. The original accepted row is never updated.
DO $correction$
DECLARE a public.booking_rental_agreements%ROWTYPE; b public.bookings%ROWTYPE; actor uuid; corrected text; corrected_hash text; old_line text:='Authorized Driver(s): Federico Flores Navarro'; new_line text:='Authorized Driver(s): Federico Flores Navarro'||chr(10)||'Additional Authorized Driver: Alejandra Ponce Gutierrez';
BEGIN
 SELECT * INTO b FROM public.bookings WHERE reservation_number='ZNX-000150'; IF NOT FOUND THEN RAISE EXCEPTION 'ZNX-000150 not found.'; END IF;
 SELECT * INTO a FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Accepted agreement for ZNX-000150 not found.'; END IF;
 IF a.document_hash<>'34c278e8b3456c9f5255f71669f0e1373639d83d9922fce010a0d79c204d72e5' THEN RAISE EXCEPTION 'ZNX-000150 original agreement hash differs from the approved correction source.'; END IF;
 IF (length(a.rendered_text)-length(replace(a.rendered_text,old_line,'')))/length(old_line)<>1 THEN RAISE EXCEPTION 'Expected authorized-driver line is not unique.'; END IF;
 corrected:=replace(a.rendered_text,old_line,new_line); corrected_hash:=encode(extensions.digest(corrected,'sha256'),'hex');
 SELECT id INTO actor FROM public.profiles WHERE is_admin ORDER BY created_at LIMIT 1; IF actor IS NULL THEN RAISE EXCEPTION 'Admin actor unavailable.'; END IF;
 INSERT INTO public.booking_rental_agreement_corrections(agreement_id,booking_id,original_document_hash,corrected_document_hash,corrected_rendered_text,correction_type,exact_correction,reason,actor_profile_id,actor_type)
 VALUES(a.id,b.id,a.document_hash,corrected_hash,corrected,'additional_authorized_driver_omission','Added Additional Authorized Driver: Alejandra Ponce Gutierrez','Correction of omitted Additional Authorized Driver.',actor,'system_on_behalf_of_admin');
END $correction$;