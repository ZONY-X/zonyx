-- =====================================================
-- FIX 1: Security Definer Views - Convert to SECURITY INVOKER with proper RLS
-- =====================================================

-- Revert views to security_invoker=true (safer default)
ALTER VIEW IF EXISTS public.hosts_public SET (security_invoker = true);
ALTER VIEW IF EXISTS public.guests_public SET (security_invoker = true);

-- Add RLS policies to allow public read of non-sensitive profile data
-- This allows the views to work without bypassing RLS

-- Hosts: Allow anyone to see approved host profiles (for marketplace display)
CREATE POLICY "Public can view approved host profiles"
ON public.hosts FOR SELECT
USING (is_approved = true);

-- Guests: Allow anyone to see guest profiles (for hosts to identify renters)
CREATE POLICY "Public can view guest profiles"
ON public.guests FOR SELECT
USING (true);

-- =====================================================
-- FIX 2: Storage Cross-Tenant Access - Restrict to booking relationships
-- =====================================================

-- Drop overly permissive policies on rental photo buckets
DROP POLICY IF EXISTS "Hosts can view guest photos for their bookings" ON storage.objects;
DROP POLICY IF EXISTS "Guests can view host photos for their bookings" ON storage.objects;
DROP POLICY IF EXISTS "Hosts can view guest-before-photos for verification" ON storage.objects;
DROP POLICY IF EXISTS "Hosts can view guest-after-photos for verification" ON storage.objects;
DROP POLICY IF EXISTS "Guests can view host-before-photos for their bookings" ON storage.objects;
DROP POLICY IF EXISTS "Guests can view host-after-photos for their bookings" ON storage.objects;

-- Create booking-scoped policies for hosts viewing guest photos
-- Hosts can only view photos from guests who have bookings with them
CREATE POLICY "Hosts view guest rental photos for their bookings only"
ON storage.objects FOR SELECT
USING (
  bucket_id IN ('guest-rental-images', 'guest-before-photos', 'guest-after-photos')
  AND auth.uid() IS NOT NULL
  AND is_host(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.host_id = get_host_id(auth.uid())
      AND b.renter_id::text = (storage.foldername(name))[1]
      AND b.status IN ('pending', 'confirmed', 'active', 'completed')
  )
);

-- Create booking-scoped policies for guests viewing host photos
-- Guests can only view photos from hosts they have bookings with
CREATE POLICY "Guests view host rental photos for their bookings only"
ON storage.objects FOR SELECT
USING (
  bucket_id IN ('host-rental-images', 'host-before-photos', 'host-after-photos')
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.bookings b
    INNER JOIN public.hosts h ON h.id = b.host_id
    WHERE b.renter_id = auth.uid()
      AND h.user_id::text = (storage.foldername(name))[1]
      AND b.status IN ('pending', 'confirmed', 'active', 'completed')
  )
);