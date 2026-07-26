-- =====================================================
-- SECURITY FIX: Address error-level findings
-- 1. Remove public access to guests PII
-- 2. Ensure hosts_public view excludes user_id
-- 3. Add validated INSERT policy for host applications
-- 4. Add booking-scoped access for hosts to view guests
-- =====================================================

-- 1. Drop the dangerous public SELECT policy on guests table
DROP POLICY IF EXISTS "Public can view guest profiles" ON public.guests;

-- 2. Add policy for hosts to view guest info ONLY for their bookings
CREATE POLICY "Hosts can view guests for their bookings"
ON public.guests FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND is_host(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.host_id = get_host_id(auth.uid())
      AND b.renter_id = guests.user_id
      AND b.status IN ('pending', 'confirmed', 'active', 'completed')
  )
);

-- 3. Add validated INSERT policy for host applications
-- This allows authenticated users to apply as hosts with server-side validation
CREATE POLICY "Users can apply to be hosts with validation"
ON public.hosts FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND LENGTH(TRIM(host_name)) BETWEEN 1 AND 100
  AND (bio IS NULL OR LENGTH(bio) <= 2000)
  AND is_approved = false
  AND NOT EXISTS (
    SELECT 1 FROM public.hosts WHERE user_id = auth.uid()
  )
);

-- 4. Drop and recreate hosts_public view to ensure it excludes user_id
-- Note: The view should ONLY expose safe fields (id, host_name, bio, avatar_url, created_at)
DROP VIEW IF EXISTS public.hosts_public;

CREATE VIEW public.hosts_public
WITH (security_invoker = true)
AS
SELECT 
    id,
    host_name,
    bio,
    avatar_url,
    created_at
FROM public.hosts
WHERE is_approved = true;

-- Grant access to the view
GRANT SELECT ON public.hosts_public TO authenticated;
GRANT SELECT ON public.hosts_public TO anon;