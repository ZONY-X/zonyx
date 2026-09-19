-- Authorized vehicle photo management using the existing ordered vehicles.images
-- array and public vehicle-images bucket. Existing vehicle URLs are untouched.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-images',
  'vehicle-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies are permissive (OR-combined). Remove any prior policy that
-- references this bucket before installing the canonical authorization rules.
DO $$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') ILIKE '%vehicle-images%'
        OR COALESCE(with_check, '') ILIKE '%vehicle-images%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', existing_policy.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Vehicle photos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'vehicle-images');

CREATE POLICY "Vehicle photos authorized insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vehicle-images'
  AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id::text = (storage.foldername(name))[2]
      AND v.host_profile_id::text = (storage.foldername(name))[1]
      AND (
        public.current_profile_is_admin()
        OR (
          v.host_profile_id = public.current_profile_id()
          AND public.current_profile_is_host()
        )
      )
  )
);

CREATE POLICY "Vehicle photos authorized update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'vehicle-images'
  AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id::text = (storage.foldername(name))[2]
      AND v.host_profile_id::text = (storage.foldername(name))[1]
      AND (
        public.current_profile_is_admin()
        OR (v.host_profile_id = public.current_profile_id() AND public.current_profile_is_host())
      )
  )
)
WITH CHECK (
  bucket_id = 'vehicle-images'
  AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id::text = (storage.foldername(name))[2]
      AND v.host_profile_id::text = (storage.foldername(name))[1]
      AND (
        public.current_profile_is_admin()
        OR (v.host_profile_id = public.current_profile_id() AND public.current_profile_is_host())
      )
  )
);

CREATE POLICY "Vehicle photos authorized delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vehicle-images'
  AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id::text = (storage.foldername(name))[2]
      AND v.host_profile_id::text = (storage.foldername(name))[1]
      AND (
        public.current_profile_is_admin()
        OR (v.host_profile_id = public.current_profile_id() AND public.current_profile_is_host())
      )
  )
);