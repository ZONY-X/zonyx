-- Append-only renewal acceptance; existing agreements, balances and HOLDs are untouched.
CREATE TABLE public.square_renewal_agreement_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES public.bookings(id),
 period_id uuid NOT NULL REFERENCES public.rental_extension_periods(id),
 submission_id uuid NOT NULL,
 version_id uuid NOT NULL REFERENCES public.rental_agreement_versions(id),
 agreement_version text NOT NULL,
 master_hash text NOT NULL CHECK(master_hash ~ '^[a-f0-9]{64}$'),
 source_revision_id uuid NOT NULL REFERENCES public.rental_agreement_revisions(id),
 source_revision_hash text NOT NULL CHECK(source_revision_hash ~ '^[a-f0-9]{64}$'),
 document_hash text NOT NULL CHECK(document_hash ~ '^[a-f0-9]{64}$'),
 rendered_text text NOT NULL,
 consent_text text NOT NULL,
 payer_name text NOT NULL,
 payer_email text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 accepted_ip inet,
 accepted_user_agent text NOT NULL,
 UNIQUE(period_id,submission_id),
 CHECK(encode(extensions.digest(rendered_text,'sha256'),'hex')=document_hash)
);
CREATE INDEX square_renewal_agreement_acceptances_booking ON public.square_renewal_agreement_acceptances(booking_id);
ALTER TABLE public.square_renewal_agreement_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_renewal_agreement_acceptances FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.square_renewal_agreement_acceptances TO service_role;
CREATE TRIGGER square_renewal_agreement_acceptances_immutable BEFORE UPDATE OR DELETE ON public.square_renewal_agreement_acceptances FOR EACH ROW EXECUTE FUNCTION public.prevent_rental_agreement_revision_mutation();
-- Existing claim remains authoritative for eligibility, price and duplicate prevention.
ALTER FUNCTION public.prepare_square_cof_checkout(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text) RENAME TO prepare_square_cof_checkout_internal;
REVOKE ALL ON FUNCTION public.prepare_square_cof_checkout_internal(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.prepare_square_cof_checkout(_kind text,_link text,_submission_id uuid,_payer jsonb,_terms_version text,_terms_text text,_terms_context jsonb,_storage_consent boolean,_future_consent boolean,_location_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE consent public.square_renewal_agreement_acceptances%ROWTYPE; target_period uuid;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 IF _kind='renewal' THEN
  SELECT period_id INTO target_period FROM public.square_renewal_payment_links WHERE token=_link AND enabled;
  SELECT * INTO consent FROM public.square_renewal_agreement_acceptances WHERE id=(_terms_context->>'rental_agreement_acceptance_id')::uuid AND period_id=target_period AND submission_id=_submission_id;
  IF NOT FOUND OR consent.payer_email<>lower(btrim(_payer->>'email')) OR consent.payer_name<>btrim(_payer->>'givenName')||' '||btrim(_payer->>'familyName') THEN RAISE EXCEPTION 'Explicit Rental Agreement acceptance is required before payment.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rental_agreement_versions v WHERE v.id=consent.version_id AND v.status='published' AND v.version=consent.agreement_version AND v.content_hash=consent.master_hash) OR NOT EXISTS(SELECT 1 FROM public.rental_agreement_current_revisions c JOIN public.rental_agreement_revisions r ON r.id=c.revision_id WHERE c.booking_id=consent.booking_id AND c.revision_id=consent.source_revision_id AND r.document_hash=consent.source_revision_hash) THEN RAISE EXCEPTION 'Rental Agreement changed. Review and accept the current document.'; END IF;
 END IF;
 RETURN public.prepare_square_cof_checkout_internal(_kind,_link,_submission_id,_payer,_terms_version,_terms_text,_terms_context,_storage_consent,_future_consent,_location_id);
END $$;
REVOKE ALL ON FUNCTION public.prepare_square_cof_checkout(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_square_cof_checkout(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text) TO service_role;
