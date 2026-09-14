-- Booking-specific, immutable Trip Rental Agreements.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS mileage_calculation_method text,
  ADD COLUMN IF NOT EXISTS included_mileage_allowance integer,
  ADD COLUMN IF NOT EXISTS additional_mile_rate_cents integer;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_mileage_calculation_method_check
    CHECK (mileage_calculation_method IS NULL OR mileage_calculation_method IN ('per_day_non_cumulative','total_trip_cumulative','custom')),
  ADD CONSTRAINT vehicles_included_mileage_allowance_check
    CHECK (included_mileage_allowance IS NULL OR included_mileage_allowance >= 0),
  ADD CONSTRAINT vehicles_additional_mile_rate_check
    CHECK (additional_mile_rate_cents IS NULL OR additional_mile_rate_cents >= 0);

-- Preserve the currently applicable terms as explicit per-vehicle data. Future
-- vehicle/custom mileage systems update these fields rather than changing the
-- agreement schema or renderer.
UPDATE public.vehicles
SET mileage_calculation_method = COALESCE(mileage_calculation_method, 'per_day_non_cumulative'),
    included_mileage_allowance = COALESCE(included_mileage_allowance, 75),
    additional_mile_rate_cents = COALESCE(additional_mile_rate_cents, 140)
WHERE mileage_calculation_method IS NULL
   OR included_mileage_allowance IS NULL
   OR additional_mile_rate_cents IS NULL;

CREATE TABLE public.rental_agreement_versions (
  id uuid PRIMARY KEY,
  version text NOT NULL UNIQUE,
  title text NOT NULL,
  canonical_body text NOT NULL,
  content_hash text NOT NULL UNIQUE CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz NOT NULL,
  retired_at timestamptz,
  status text NOT NULL CHECK (status IN ('published','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (retired_at IS NULL OR retired_at >= effective_at)
);

CREATE TABLE public.booking_rental_agreements (
  id uuid PRIMARY KEY,
  booking_id uuid UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  proposed_booking_id uuid NOT NULL UNIQUE,
  master_agreement_id uuid NOT NULL REFERENCES public.rental_agreement_versions(id) ON DELETE RESTRICT,
  master_version text NOT NULL,
  guest_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  guest_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  accepted_at timestamptz,
  accepted_ip inet,
  accepted_user_agent text,
  trip_financial_summary jsonb NOT NULL,
  rendered_text text NOT NULL,
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  preparation_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guest_profile_id, idempotency_key),
  CHECK (
    (accepted_at IS NULL AND booking_id IS NULL AND accepted_ip IS NULL AND accepted_user_agent IS NULL)
    OR (accepted_at IS NOT NULL AND booking_id = proposed_booking_id)
  )
);

CREATE INDEX booking_rental_agreements_guest_idx ON public.booking_rental_agreements(guest_profile_id, prepared_at DESC);
CREATE INDEX booking_rental_agreements_booking_idx ON public.booking_rental_agreements(booking_id) WHERE booking_id IS NOT NULL;

ALTER TABLE public.rental_agreement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_rental_agreements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rental_agreement_versions, public.booking_rental_agreements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.rental_agreement_versions, public.booking_rental_agreements TO service_role;
GRANT UPDATE, DELETE ON public.booking_rental_agreements TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_rental_agreement_version_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'Published Rental Agreement versions are immutable.';
END; $$;

CREATE TRIGGER prevent_rental_agreement_version_update_delete
BEFORE UPDATE OR DELETE ON public.rental_agreement_versions
FOR EACH ROW EXECUTE FUNCTION public.prevent_rental_agreement_version_mutation();

CREATE OR REPLACE FUNCTION public.protect_booking_rental_agreement_history()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Accepted Rental Agreement history is immutable.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Accepted Rental Agreement history is immutable.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Rental Agreement identity cannot change.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER protect_booking_rental_agreement_history_trigger
BEFORE UPDATE OR DELETE ON public.booking_rental_agreements
FOR EACH ROW EXECUTE FUNCTION public.protect_booking_rental_agreement_history();

CREATE OR REPLACE FUNCTION public.accept_prepared_rental_agreement(
  _agreement_id uuid,
  _document_hash text,
  _terms_accepted boolean,
  _rental_agreement_accepted boolean,
  _guest_auth_user_id uuid,
  _accepted_ip inet,
  _accepted_user_agent text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  agreement_row public.booking_rental_agreements%ROWTYPE;
  summary jsonb;
  booking_id uuid;
  requested_start_ts timestamp;
  requested_end_ts timestamp;
  eligibility_status text;
BEGIN
  IF NOT _terms_accepted THEN RAISE EXCEPTION 'You must accept the ZONYX Terms of Service before booking.'; END IF;
  IF NOT _rental_agreement_accepted THEN RAISE EXCEPTION 'You must accept the booking-specific ZONYX Rental Agreement before booking.'; END IF;

  SELECT * INTO agreement_row FROM public.booking_rental_agreements
  WHERE id=_agreement_id AND guest_auth_user_id=_guest_auth_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prepared Rental Agreement not found.'; END IF;
  IF agreement_row.accepted_at IS NOT NULL THEN RETURN agreement_row.booking_id; END IF;
  IF agreement_row.preparation_expires_at < now() THEN RAISE EXCEPTION 'Prepared Rental Agreement has expired.'; END IF;
  IF agreement_row.document_hash <> _document_hash THEN RAISE EXCEPTION 'Rental Agreement document changed. Review it again.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rental_agreement_versions v
    WHERE v.id=agreement_row.master_agreement_id AND v.version=agreement_row.master_version AND v.status='published'
  ) THEN RAISE EXCEPTION 'Rental Agreement Master version is unavailable.'; END IF;

  summary := agreement_row.trip_financial_summary;
  IF NOT (
    summary ?& ARRAY['reservation_number','vehicle_id','host_profile_id','start_date','end_date','pickup_time','dropoff_time','pickup_location','dropoff_location',
      'subtotal_cents','service_fee_cents','taxes_cents','final_total_cents','currency','authorization_hold_amount_cents',
      'mileage_calculation_method','included_mileage_allowance','additional_mile_rate_cents','authorized_drivers','additional_booking_specific_terms']
  ) THEN RAISE EXCEPTION 'Prepared Rental Agreement is incomplete.'; END IF;
  requested_start_ts := (summary->>'start_date')::date::timestamp + (summary->>'pickup_time')::time;
  requested_end_ts := (summary->>'end_date')::date::timestamp + (summary->>'dropoff_time')::time;
  IF requested_end_ts <= requested_start_ts THEN RAISE EXCEPTION 'Drop-off must be after pickup.'; END IF;

  SELECT public.driver_eligibility_status(d.date_of_birth,d.license_expiration_date,d.self_attested_at,(summary->>'end_date')::date)
  INTO eligibility_status FROM public.driver_eligibility d WHERE d.profile_id=agreement_row.guest_profile_id;
  IF COALESCE(eligibility_status,'incomplete') <> 'eligible_self_attested' THEN RAISE EXCEPTION 'Driver eligibility requirements are not met.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(summary->>'vehicle_id'));
  IF EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.vehicle_id=(summary->>'vehicle_id')::uuid
    AND tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)')
      && tsrange(requested_start_ts,requested_end_ts,'[)')
    AND (b.trip_status IN ('confirmed','active','pending_inspection') OR (b.trip_status='pending_payment' AND b.created_at>=now()-interval '20 minutes'))
  ) THEN RAISE EXCEPTION 'Vehicle is not available for the selected dates.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=(summary->>'vehicle_id')::uuid
    AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)') && tsrange(requested_start_ts,requested_end_ts,'[)')
  ) THEN RAISE EXCEPTION 'Vehicle is not available for the selected dates.'; END IF;

  booking_id := agreement_row.proposed_booking_id;
  INSERT INTO public.bookings(
    id,reservation_number,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_location,dropoff_location,pickup_time,dropoff_time,
    fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,
    authorization_hold_amount_cents,terms_accepted_at,rental_agreement_accepted_at
  ) VALUES (
    booking_id,summary->>'reservation_number',agreement_row.guest_profile_id,(summary->>'host_profile_id')::uuid,(summary->>'vehicle_id')::uuid,
    (summary->>'start_date')::date,(summary->>'end_date')::date,summary->>'pickup_location',summary->>'dropoff_location',
    (summary->>'pickup_time')::time,(summary->>'dropoff_time')::time,summary->>'fulfillment_method','pending_payment',
    (summary->>'subtotal_cents')::integer,(summary->>'service_fee_cents')::integer,(summary->>'taxes_cents')::integer,
    (summary->>'final_total_cents')::integer,summary->>'currency',(summary->>'authorization_hold_amount_cents')::integer,now(),now()
  );

  PERFORM set_config('app.rental_agreement_acceptance','allowed',true);
  UPDATE public.booking_rental_agreements SET
    booking_id=booking_id,accepted_at=now(),accepted_ip=_accepted_ip,accepted_user_agent=NULLIF(_accepted_user_agent,'')
  WHERE id=agreement_row.id;
  RETURN booking_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_booking_rental_agreement(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF NOT(public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;
  SELECT * INTO a FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accepted Rental Agreement not found.'; END IF;
  RETURN jsonb_build_object(
    'id',a.id,'booking_id',a.booking_id,'master_version',a.master_version,'accepted_at',a.accepted_at,
    'document_hash',a.document_hash,'rendered_text',a.rendered_text,'trip_financial_summary',a.trip_financial_summary
  );
END; $$;

CREATE OR REPLACE FUNCTION public.get_accessible_booking_rental_agreement_ids()
RETURNS TABLE(booking_id uuid) LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
  SELECT a.booking_id
  FROM public.booking_rental_agreements a
  JOIN public.bookings b ON b.id=a.booking_id
  WHERE a.accepted_at IS NOT NULL
    AND (public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id());
$$;

REVOKE ALL ON FUNCTION public.accept_prepared_rental_agreement(uuid,text,boolean,boolean,uuid,inet,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_prepared_rental_agreement(uuid,text,boolean,boolean,uuid,inet,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_booking_rental_agreement(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_booking_rental_agreement(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_accessible_booking_rental_agreement_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_accessible_booking_rental_agreement_ids() TO authenticated;