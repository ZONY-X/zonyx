CREATE TABLE public.reservation_agreement_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposed_booking_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  guest_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  start_date date NOT NULL,end_date date NOT NULL,pickup_time time NOT NULL,dropoff_time time NOT NULL,
  pickup_location text NOT NULL,dropoff_location text NOT NULL,reservation_fingerprint text NOT NULL CHECK(reservation_fingerprint~'^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','prepared','accepted','revoked','expired')),
  prepared_agreement_id uuid UNIQUE,prepared_at timestamptz,accepted_at timestamptz,revoked_at timestamptz,
  protection_provider text,protection_product text,insured_primary_driver_name text,policy_or_certificate_number text,
  coverage_start_at timestamptz,coverage_end_at timestamptz,protection_limit_cents bigint,rental_vehicle_excess_cents bigint,
  protection_currency text,protection_verified_at timestamptz,administrative_source text NOT NULL,
  administrative_source_reference text,administrative_note text,created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),CHECK(end_date>start_date),
  CHECK(protection_provider IS NULL OR(length(btrim(protection_provider))>=2 AND length(btrim(protection_product))>=2 AND length(btrim(insured_primary_driver_name))>=2 AND length(btrim(policy_or_certificate_number))>=2 AND coverage_start_at IS NOT NULL AND coverage_end_at>coverage_start_at AND protection_verified_at IS NOT NULL AND protection_currency~'^[a-z]{3}$'))
);
CREATE TABLE public.reservation_additional_authorized_drivers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reservation_context_id uuid NOT NULL REFERENCES public.reservation_agreement_contexts(id) ON DELETE RESTRICT,
 full_legal_name text NOT NULL CHECK(length(btrim(full_legal_name)) BETWEEN 2 AND 200),approval_status text NOT NULL CHECK(approval_status IN('approved','revoked')),
 approved_at timestamptz NOT NULL,approved_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 administrative_source text NOT NULL,administrative_source_reference text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(reservation_context_id,full_legal_name)
);
CREATE TABLE public.reservation_agreement_context_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reservation_context_id uuid NOT NULL REFERENCES public.reservation_agreement_contexts(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN('created','protection_verified','driver_approved','driver_revoked','prepared','accepted','revoked')),
 actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,reason text NOT NULL CHECK(length(btrim(reason))>=5),
 before_state jsonb NOT NULL DEFAULT '{}',after_state jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_rental_agreements ADD COLUMN reservation_context_id uuid REFERENCES public.reservation_agreement_contexts(id) ON DELETE RESTRICT;
ALTER TABLE public.reservation_agreement_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_additional_authorized_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_agreement_context_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_agreement_contexts,public.reservation_additional_authorized_drivers,public.reservation_agreement_context_audit FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.prevent_reservation_context_audit_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Reservation agreement context audit is immutable.'; END $$;
CREATE TRIGGER prevent_reservation_context_audit_mutation BEFORE UPDATE OR DELETE ON public.reservation_agreement_context_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_reservation_context_audit_mutation();

CREATE FUNCTION public.admin_create_reservation_agreement_context(_guest_email text,_vehicle_id uuid,_start_date date,_pickup_time time,_end_date date,_dropoff_time time,_pickup_location text,_dropoff_location text,_protection jsonb,_additional_drivers jsonb,_administrative_source text,_administrative_source_reference text,_reason text)
RETURNS TABLE(reservation_context_id uuid,proposed_booking_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; guest public.profiles%ROWTYPE; ctx uuid; proposed uuid; fingerprint text; item jsonb; protection jsonb:=COALESCE(_protection,'null'::jsonb);
BEGIN
 IF auth.uid() IS NULL OR NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 IF length(btrim(COALESCE(_reason,'')))<5 OR length(btrim(COALESCE(_administrative_source,'')))<2 THEN RAISE EXCEPTION 'Administrative source and reason are required.'; END IF;
 SELECT * INTO guest FROM public.profiles WHERE lower(email)=lower(btrim(_guest_email)) LIMIT 1; IF NOT FOUND THEN RAISE EXCEPTION 'Guest profile not found.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=_vehicle_id) THEN RAISE EXCEPTION 'Vehicle not found.'; END IF;
 IF _end_date::timestamp+_dropoff_time<=_start_date::timestamp+_pickup_time THEN RAISE EXCEPTION 'Drop-off must be after pickup.'; END IF;
 IF protection<>'null' AND (
   jsonb_typeof(protection)<>'object'
   OR protection->>'provider'<>'CarInsuRent'
   OR protection->>'product'<>'Rental Vehicle Excess Protection'
   OR NULLIF(btrim(protection->>'insured_primary_driver_name'),'') IS NULL
   OR NULLIF(btrim(protection->>'policy_or_certificate_number'),'') IS NULL
   OR protection->>'coverage_start_at' IS NULL
   OR protection->>'coverage_end_at' IS NULL
   OR (protection->>'coverage_end_at')::timestamptz<=(protection->>'coverage_start_at')::timestamptz
 ) THEN RAISE EXCEPTION 'Unsupported or incomplete reservation protection.'; END IF;
 actor:=public.current_profile_id(); proposed:=gen_random_uuid();
 fingerprint:=encode(extensions.digest(concat_ws('|',guest.id,_vehicle_id,_start_date,_pickup_time,_end_date,_dropoff_time,btrim(_pickup_location),btrim(_dropoff_location)),'sha256'),'hex');
 INSERT INTO public.reservation_agreement_contexts(proposed_booking_id,guest_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,reservation_fingerprint,
 protection_provider,protection_product,insured_primary_driver_name,policy_or_certificate_number,coverage_start_at,coverage_end_at,protection_limit_cents,rental_vehicle_excess_cents,protection_currency,protection_verified_at,
 administrative_source,administrative_source_reference,administrative_note,created_by_profile_id)
 VALUES(proposed,guest.id,_vehicle_id,_start_date,_end_date,_pickup_time,_dropoff_time,btrim(_pickup_location),btrim(_dropoff_location),fingerprint,
 CASE WHEN protection='null' THEN NULL ELSE protection->>'provider' END,CASE WHEN protection='null' THEN NULL ELSE protection->>'product' END,CASE WHEN protection='null' THEN NULL ELSE protection->>'insured_primary_driver_name' END,
 CASE WHEN protection='null' THEN NULL ELSE protection->>'policy_or_certificate_number' END,CASE WHEN protection='null' THEN NULL ELSE (protection->>'coverage_start_at')::timestamptz END,CASE WHEN protection='null' THEN NULL ELSE (protection->>'coverage_end_at')::timestamptz END,
 CASE WHEN protection='null' OR protection->>'protection_limit_cents' IS NULL THEN NULL ELSE (protection->>'protection_limit_cents')::bigint END,CASE WHEN protection='null' OR protection->>'rental_vehicle_excess_cents' IS NULL THEN NULL ELSE (protection->>'rental_vehicle_excess_cents')::bigint END,
 CASE WHEN protection='null' THEN NULL ELSE lower(protection->>'currency') END,CASE WHEN protection='null' THEN NULL ELSE now() END,
 btrim(_administrative_source),NULLIF(btrim(_administrative_source_reference),''),btrim(_reason),actor) RETURNING id INTO ctx;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(_additional_drivers,'[]')) LOOP
  IF item->>'approval_status'<>'approved' THEN RAISE EXCEPTION 'Only approved Additional Authorized Drivers may be saved.'; END IF;
  INSERT INTO public.reservation_additional_authorized_drivers(reservation_context_id,full_legal_name,approval_status,approved_at,approved_by_profile_id,administrative_source,administrative_source_reference)
  VALUES(ctx,btrim(item->>'full_legal_name'),'approved',now(),actor,btrim(_administrative_source),NULLIF(btrim(_administrative_source_reference),''));
  INSERT INTO public.reservation_agreement_context_audit(reservation_context_id,action,actor_profile_id,reason,after_state)
  VALUES(ctx,'driver_approved',actor,btrim(_reason),jsonb_build_object('full_legal_name',btrim(item->>'full_legal_name'),'approved_at',now()));
 END LOOP;
 INSERT INTO public.reservation_agreement_context_audit(reservation_context_id,action,actor_profile_id,reason,after_state) VALUES(ctx,'created',actor,btrim(_reason),jsonb_build_object('proposed_booking_id',proposed,'protection',protection,'additional_drivers',COALESCE(_additional_drivers,'[]')));
 IF protection<>'null' THEN
  INSERT INTO public.reservation_agreement_context_audit(reservation_context_id,action,actor_profile_id,reason,after_state)
  VALUES(ctx,'protection_verified',actor,btrim(_reason),jsonb_build_object('provider',protection->>'provider','product',protection->>'product','policy_or_certificate_number',protection->>'policy_or_certificate_number','verified_at',now()));
 END IF;
 RETURN QUERY SELECT ctx,proposed;
END $$;
REVOKE ALL ON FUNCTION public.admin_create_reservation_agreement_context(text,uuid,date,time,date,time,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_create_reservation_agreement_context(text,uuid,date,time,date,time,text,text,jsonb,jsonb,text,text,text) TO authenticated;

CREATE FUNCTION public.admin_revoke_reservation_agreement_context(_context_id uuid,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; ctx public.reservation_agreement_contexts%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Revocation reason is required.'; END IF;
 SELECT * INTO ctx FROM public.reservation_agreement_contexts WHERE id=_context_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trusted reservation context not found.'; END IF;
 IF ctx.status NOT IN('active','prepared') THEN RAISE EXCEPTION 'Only active or prepared contexts may be revoked.'; END IF;
 actor:=public.current_profile_id();
 IF ctx.prepared_agreement_id IS NOT NULL THEN
  DELETE FROM public.booking_rental_agreements WHERE id=ctx.prepared_agreement_id AND accepted_at IS NULL;
 END IF;
 UPDATE public.reservation_agreement_contexts SET status='revoked',revoked_at=now(),prepared_agreement_id=NULL,prepared_at=NULL WHERE id=ctx.id;
 INSERT INTO public.reservation_agreement_context_audit(reservation_context_id,action,actor_profile_id,reason,before_state,after_state)
 VALUES(ctx.id,'revoked',actor,btrim(_reason),jsonb_build_object('status',ctx.status,'prepared_agreement_id',ctx.prepared_agreement_id),jsonb_build_object('status','revoked'));
END $$;
REVOKE ALL ON FUNCTION public.admin_revoke_reservation_agreement_context(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_reservation_agreement_context(uuid,text) TO authenticated;

CREATE FUNCTION public.claim_reservation_agreement_context(_context_id uuid,_agreement_id uuid,_guest_profile_id uuid,_vehicle_id uuid,_start_date date,_pickup_time time,_end_date date,_dropoff_time time,_pickup_location text,_dropoff_location text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ctx public.reservation_agreement_contexts%ROWTYPE; expected text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO ctx FROM public.reservation_agreement_contexts WHERE id=_context_id FOR UPDATE;
 IF NOT FOUND OR ctx.status<>'active' THEN RAISE EXCEPTION 'Trusted reservation context is no longer available.'; END IF;
 expected:=encode(extensions.digest(concat_ws('|',_guest_profile_id,_vehicle_id,_start_date,_pickup_time,_end_date,_dropoff_time,btrim(_pickup_location),btrim(_dropoff_location)),'sha256'),'hex');
 IF ctx.guest_profile_id<>_guest_profile_id OR ctx.vehicle_id<>_vehicle_id OR ctx.reservation_fingerprint<>expected OR ctx.start_date<>_start_date OR ctx.end_date<>_end_date OR ctx.pickup_time<>_pickup_time OR ctx.dropoff_time<>_dropoff_time OR ctx.pickup_location<>_pickup_location OR ctx.dropoff_location<>_dropoff_location THEN RAISE EXCEPTION 'The trusted reservation configuration does not match this booking.'; END IF;
 IF ctx.protection_provider IS NOT NULL AND (
   ctx.protection_provider<>'CarInsuRent'
   OR ctx.protection_product<>'Rental Vehicle Excess Protection'
   OR ctx.insured_primary_driver_name IS DISTINCT FROM (SELECT d.legal_name FROM public.driver_eligibility d WHERE d.profile_id=_guest_profile_id)
   OR ctx.protection_verified_at IS NULL
   OR ctx.coverage_start_at>((_start_date+_pickup_time) AT TIME ZONE 'America/New_York')
   OR ctx.coverage_end_at<((_end_date+_dropoff_time) AT TIME ZONE 'America/New_York')
 ) THEN RAISE EXCEPTION 'Trusted reservation protection is incomplete or does not apply to this reservation.'; END IF;
 UPDATE public.reservation_agreement_contexts SET status='prepared',prepared_agreement_id=_agreement_id,prepared_at=now() WHERE id=ctx.id;
 INSERT INTO public.reservation_agreement_context_audit(reservation_context_id,action,actor_profile_id,reason,after_state) VALUES(ctx.id,'prepared',ctx.created_by_profile_id,'Rental Agreement prepared',jsonb_build_object('agreement_id',_agreement_id));
END $$;
REVOKE ALL ON FUNCTION public.claim_reservation_agreement_context(uuid,uuid,uuid,uuid,date,time,date,time,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reservation_agreement_context(uuid,uuid,uuid,uuid,date,time,date,time,text,text) TO service_role;

CREATE FUNCTION public.bind_accepted_reservation_context() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ctx public.reservation_agreement_contexts%ROWTYPE;
BEGIN
 IF NEW.accepted_at IS NULL OR OLD.accepted_at IS NOT NULL OR NEW.reservation_context_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO ctx FROM public.reservation_agreement_contexts WHERE id=NEW.reservation_context_id FOR UPDATE;
 IF NOT FOUND OR ctx.status<>'prepared' OR ctx.prepared_agreement_id<>NEW.id OR ctx.proposed_booking_id<>NEW.booking_id OR ctx.guest_profile_id<>NEW.guest_profile_id THEN
  RAISE EXCEPTION 'Trusted reservation context does not match the accepted agreement.';
 END IF;
 UPDATE public.reservation_agreement_contexts SET booking_id=NEW.booking_id,status='accepted',accepted_at=NEW.accepted_at WHERE id=ctx.id;
 INSERT INTO public.reservation_agreement_context_audit(reservation_context_id,action,actor_profile_id,reason,before_state,after_state)
 VALUES(ctx.id,'accepted',ctx.created_by_profile_id,'Agreement accepted and booking created',jsonb_build_object('status',ctx.status),jsonb_build_object('status','accepted','booking_id',NEW.booking_id));
 RETURN NEW;
END $$;
CREATE TRIGGER bind_accepted_reservation_context AFTER UPDATE OF accepted_at,booking_id ON public.booking_rental_agreements FOR EACH ROW EXECUTE FUNCTION public.bind_accepted_reservation_context();
