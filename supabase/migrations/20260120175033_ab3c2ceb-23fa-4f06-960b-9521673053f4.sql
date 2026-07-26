-- ===========================================
-- FIX 1: Remove email column from hosts table
-- (Email is already stored in auth.users, duplicating creates exposure risk)
-- ===========================================

ALTER TABLE public.hosts DROP COLUMN IF EXISTS email;

-- Update the hosts_public view to ensure it still works
DROP VIEW IF EXISTS public.hosts_public;

CREATE VIEW public.hosts_public
WITH (security_invoker = on) AS
SELECT 
  id, 
  host_name, 
  bio, 
  avatar_url, 
  created_at
FROM public.hosts
WHERE is_approved = true;

-- Grant access to the public view
GRANT SELECT ON public.hosts_public TO anon, authenticated;

-- ===========================================
-- FIX 2: Create access_requests table for form submissions
-- ===========================================

CREATE TABLE IF NOT EXISTS public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending'
);

-- Enable RLS
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- Allow anyone to submit access requests (no auth required for lead capture)
CREATE POLICY "Anyone can submit access requests"
  ON public.access_requests FOR INSERT
  WITH CHECK (true);

-- Only authenticated admins/staff should be able to view requests
-- For now, we'll block all SELECT (admin functionality would be added separately)
CREATE POLICY "No public read access to requests"
  ON public.access_requests FOR SELECT
  USING (false);

-- ===========================================
-- FIX 3: Create secure booking function with validation
-- ===========================================

CREATE OR REPLACE FUNCTION public.create_booking(
  _vehicle_id UUID,
  _start_date DATE,
  _end_date DATE,
  _pickup_location TEXT DEFAULT NULL,
  _dropoff_location TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _host_id UUID;
  _price_per_day INTEGER;
  _days INTEGER;
  _total_price DECIMAL;
  _booking_id UUID;
BEGIN
  -- Validate user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate dates
  IF _start_date >= _end_date THEN
    RAISE EXCEPTION 'Start date must be before end date';
  END IF;
  
  IF _start_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot book dates in the past';
  END IF;
  
  -- Validate input lengths (prevent excessively long strings)
  IF _pickup_location IS NOT NULL AND LENGTH(_pickup_location) > 500 THEN
    RAISE EXCEPTION 'Pickup location too long';
  END IF;
  
  IF _dropoff_location IS NOT NULL AND LENGTH(_dropoff_location) > 500 THEN
    RAISE EXCEPTION 'Dropoff location too long';
  END IF;
  
  -- Get vehicle info and validate availability
  SELECT host_id, price_per_day INTO _host_id, _price_per_day
  FROM public.vehicles
  WHERE id = _vehicle_id AND is_available = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not available';
  END IF;
  
  -- Check for overlapping bookings
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE vehicle_id = _vehicle_id
      AND status NOT IN ('cancelled', 'completed')
      AND daterange(start_date, end_date, '[]') && daterange(_start_date, _end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'Vehicle already booked for these dates';
  END IF;
  
  -- Calculate price server-side (prevent price manipulation)
  _days := _end_date - _start_date;
  _total_price := _price_per_day * _days;
  
  -- Create booking with server-calculated values
  INSERT INTO public.bookings (
    vehicle_id, host_id, renter_id,
    start_date, end_date,
    pickup_location, dropoff_location,
    total_price, status
  )
  VALUES (
    _vehicle_id, _host_id, auth.uid(),
    _start_date, _end_date,
    _pickup_location, _dropoff_location,
    _total_price, 'pending'
  )
  RETURNING id INTO _booking_id;
  
  RETURN _booking_id;
END;
$$;

-- Remove the insecure direct INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create bookings" ON public.bookings;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.create_booking TO authenticated;