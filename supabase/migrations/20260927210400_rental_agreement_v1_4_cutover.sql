-- Accepted v1.2/v1.3 snapshots are immutable and deliberately excluded.
DELETE FROM public.booking_rental_agreements
WHERE accepted_at IS NULL
  AND master_version = '1.3';