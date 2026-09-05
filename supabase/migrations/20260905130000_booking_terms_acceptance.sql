-- Restore customer terms + rental agreement acceptance for bookings.
--
-- Bookings created through the customer booking flow must record explicit,
-- time-stamped acceptance of the ZONYX Terms of Service and the ZONYX Rental
-- Agreement (House Rules) before payment. The customer booking page blocks
-- checkout until both are checked and stores acceptance server-side so it is
-- not faked in React state.

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
ADD COLUMN IF NOT EXISTS rental_agreement_accepted_at timestamptz;

COMMENT ON COLUMN public.bookings.terms_accepted_at IS 'UTC timestamp the renter accepted the ZONYX Terms of Service during checkout.';
COMMENT ON COLUMN public.bookings.rental_agreement_accepted_at IS 'UTC timestamp the renter accepted the ZONYX Rental Agreement / House Rules during checkout.';