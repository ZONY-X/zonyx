-- Create storage bucket for guest rental photos (before/after)
INSERT INTO storage.buckets (id, name, public)
VALUES ('guest-rental-images', 'guest-rental-images', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for host rental photos (before/after)
INSERT INTO storage.buckets (id, name, public)
VALUES ('host-rental-images', 'host-rental-images', false)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for guest-rental-images bucket
-- Guests can upload their own photos
CREATE POLICY "Guests can upload their rental photos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'guest-rental-images' 
  AND auth.uid() IS NOT NULL
  AND is_guest(auth.uid())
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Guests can view their own photos
CREATE POLICY "Guests can view their rental photos"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'guest-rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Guests can update their own photos
CREATE POLICY "Guests can update their rental photos"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'guest-rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Guests can delete their own photos
CREATE POLICY "Guests can delete their rental photos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'guest-rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Hosts can view guest photos for their bookings (for verification)
CREATE POLICY "Hosts can view guest photos for their bookings"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'guest-rental-images' 
  AND auth.uid() IS NOT NULL
  AND is_host(auth.uid())
);

-- RLS Policies for host-rental-images bucket
-- Hosts can upload their own photos
CREATE POLICY "Hosts can upload their rental photos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'host-rental-images' 
  AND auth.uid() IS NOT NULL
  AND is_host(auth.uid())
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Hosts can view their own photos
CREATE POLICY "Hosts can view their rental photos"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'host-rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Hosts can update their own photos
CREATE POLICY "Hosts can update their rental photos"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'host-rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Hosts can delete their own photos
CREATE POLICY "Hosts can delete their rental photos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'host-rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Guests can view host photos for their bookings (for verification)
CREATE POLICY "Guests can view host photos for their bookings"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'host-rental-images' 
  AND auth.uid() IS NOT NULL
  AND is_guest(auth.uid())
);