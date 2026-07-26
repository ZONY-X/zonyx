-- Add booking-scoped policy for the legacy rental-images bucket
-- This allows hosts to view photos uploaded by guests they have bookings with

CREATE POLICY "Hosts view rental-images for their bookings"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'rental-images'
  AND auth.uid() IS NOT NULL
  AND is_host(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.host_id = get_host_id(auth.uid())
      AND b.renter_id::text = (storage.foldername(name))[1]
      AND b.status IN ('pending', 'confirmed', 'active', 'completed')
  )
);

-- Also allow guests to view their own photos in rental-images
CREATE POLICY "Guests view their own rental-images"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'rental-images'
  AND auth.uid() IS NOT NULL
  AND auth.uid()::text = (storage.foldername(name))[1]
);