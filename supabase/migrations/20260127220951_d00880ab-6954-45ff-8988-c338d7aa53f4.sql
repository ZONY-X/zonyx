-- Create 4 separate buckets for complete photo organization

-- Guest Before Photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('guest-before-photos', 'guest-before-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Guest After Photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('guest-after-photos', 'guest-after-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Host Before Photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('host-before-photos', 'host-before-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Host After Photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('host-after-photos', 'host-after-photos', false)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for guest-before-photos
CREATE POLICY "Guests can upload to guest-before-photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'guest-before-photos' 
  AND auth.uid() IS NOT NULL
  AND is_guest(auth.uid())
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Guests can view their guest-before-photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'guest-before-photos' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Guests can delete their guest-before-photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'guest-before-photos' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Hosts can view guest-before-photos for verification"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'guest-before-photos' 
  AND auth.uid() IS NOT NULL
  AND is_host(auth.uid())
);

-- RLS Policies for guest-after-photos
CREATE POLICY "Guests can upload to guest-after-photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'guest-after-photos' 
  AND auth.uid() IS NOT NULL
  AND is_guest(auth.uid())
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Guests can view their guest-after-photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'guest-after-photos' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Guests can delete their guest-after-photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'guest-after-photos' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Hosts can view guest-after-photos for verification"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'guest-after-photos' 
  AND auth.uid() IS NOT NULL
  AND is_host(auth.uid())
);

-- RLS Policies for host-before-photos
CREATE POLICY "Hosts can upload to host-before-photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'host-before-photos' 
  AND auth.uid() IS NOT NULL
  AND is_host(auth.uid())
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Hosts can view their host-before-photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'host-before-photos' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Hosts can delete their host-before-photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'host-before-photos' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Guests can view host-before-photos for their bookings"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'host-before-photos' 
  AND auth.uid() IS NOT NULL
  AND is_guest(auth.uid())
);

-- RLS Policies for host-after-photos
CREATE POLICY "Hosts can upload to host-after-photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'host-after-photos' 
  AND auth.uid() IS NOT NULL
  AND is_host(auth.uid())
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Hosts can view their host-after-photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'host-after-photos' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Hosts can delete their host-after-photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'host-after-photos' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Guests can view host-after-photos for their bookings"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'host-after-photos' 
  AND auth.uid() IS NOT NULL
  AND is_guest(auth.uid())
);