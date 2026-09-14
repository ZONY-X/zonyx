-- Applied only after the booking-specific agreement frontend is live.
-- Prevents clients from creating bookings with acceptance booleans alone.
REVOKE EXECUTE ON FUNCTION public.create_booking(uuid,date,date,text,text,time,time,boolean,boolean) FROM PUBLIC, anon, authenticated;