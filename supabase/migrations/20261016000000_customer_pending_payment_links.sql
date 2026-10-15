-- Lets a customer resume checkout for their own unpaid reservations; returns no other customer's data.
CREATE OR REPLACE FUNCTION public.get_my_pending_payment_links()
RETURNS TABLE(booking_id uuid, agreement_id uuid) LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
  SELECT DISTINCT ON (b.id) b.id, a.id
  FROM public.bookings b
  JOIN public.booking_rental_agreements a ON a.booking_id=b.id AND a.accepted_at IS NOT NULL
  WHERE b.renter_profile_id=public.current_profile_id()
    AND b.trip_status='pending_payment'
  ORDER BY b.id, a.accepted_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_pending_payment_links() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_payment_links() TO authenticated;
