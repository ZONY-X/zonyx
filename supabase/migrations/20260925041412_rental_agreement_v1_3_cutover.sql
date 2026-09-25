-- Rental Agreement v1.3 cutover.
-- Accepted v1.2 snapshots remain immutable and unchanged. Only unaccepted v1.2
-- preparations are invalidated so every future acceptance reviews v1.3.

DELETE FROM public.booking_rental_agreements
WHERE accepted_at IS NULL
  AND master_version = '1.2';

CREATE OR REPLACE FUNCTION public.get_booking_rental_agreement(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  a public.booking_rental_agreements%ROWTYPE;
  v public.rental_agreement_versions%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF NOT (
    public.current_profile_is_admin()
    OR b.renter_profile_id = public.current_profile_id()
    OR b.host_profile_id = public.current_profile_id()
  ) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  SELECT * INTO a
  FROM public.booking_rental_agreements
  WHERE booking_id = b.id AND accepted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accepted Rental Agreement not found.'; END IF;

  SELECT * INTO v FROM public.rental_agreement_versions WHERE id = a.master_agreement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rental Agreement Master version is unavailable.'; END IF;

  RETURN jsonb_build_object(
    'id', a.id,
    'booking_id', a.booking_id,
    'master_agreement_id', a.master_agreement_id,
    'master_version', a.master_version,
    'agreement_effective_at', v.effective_at,
    'accepted_at', a.accepted_at,
    'document_hash', a.document_hash,
    'rendered_text', a.rendered_text,
    'trip_financial_summary', a.trip_financial_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_booking_rental_agreement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_rental_agreement(uuid) TO authenticated;