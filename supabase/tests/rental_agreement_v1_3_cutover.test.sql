BEGIN;

DO $test$
DECLARE
  accepted_record public.booking_rental_agreements%ROWTYPE;
  retrieved jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.booking_rental_agreements
    WHERE accepted_at IS NULL AND master_version = '1.2'
  ) THEN
    RAISE EXCEPTION 'Unaccepted v1.2 preparations remain after the v1.3 cutover.';
  END IF;

  SELECT * INTO accepted_record
  FROM public.booking_rental_agreements
  WHERE accepted_at IS NOT NULL
  ORDER BY accepted_at
  LIMIT 1;

  IF accepted_record.id IS NOT NULL THEN
    BEGIN
      UPDATE public.booking_rental_agreements
      SET rendered_text = rendered_text || ' tampered'
      WHERE id = accepted_record.id;
      RAISE EXCEPTION 'Accepted agreement mutation unexpectedly succeeded.';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'Accepted agreement mutation unexpectedly succeeded.' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%Accepted Rental Agreement history is immutable.%' THEN RAISE; END IF;
    END;

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', accepted_record.guest_auth_user_id::text, true);
    retrieved := public.get_booking_rental_agreement(accepted_record.booking_id);

    IF retrieved->>'master_agreement_id' IS DISTINCT FROM accepted_record.master_agreement_id::text
       OR retrieved->>'master_version' IS DISTINCT FROM accepted_record.master_version
       OR retrieved->>'agreement_effective_at' IS NULL
       OR retrieved->>'document_hash' IS DISTINCT FROM accepted_record.document_hash
       OR retrieved->>'rendered_text' IS DISTINCT FROM accepted_record.rendered_text THEN
      RAISE EXCEPTION 'Accepted agreement retrieval changed immutable version or snapshot data.';
    END IF;
  END IF;

  RAISE NOTICE 'PASS: v1.3 cutover removed only legacy preparations and preserved accepted snapshots';
END $test$;

ROLLBACK;