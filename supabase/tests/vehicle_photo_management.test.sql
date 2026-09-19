BEGIN;

DO $$
DECLARE
  bucket_public boolean;
  bucket_limit bigint;
  policy_count integer;
BEGIN
  SELECT public, file_size_limit
  INTO bucket_public, bucket_limit
  FROM storage.buckets
  WHERE id = 'vehicle-images';

  IF bucket_public IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'vehicle-images must remain public for Fleet and Vehicle Detail';
  END IF;

  IF bucket_limit IS DISTINCT FROM 10485760 THEN
    RAISE EXCEPTION 'vehicle-images file limit must be 10 MB';
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'Vehicle photos public read',
      'Vehicle photos authorized insert',
      'Vehicle photos authorized update',
      'Vehicle photos authorized delete'
    );

  IF policy_count <> 4 THEN
    RAISE EXCEPTION 'expected four vehicle photo storage policies, found %', policy_count;
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND (
      COALESCE(qual, '') ILIKE '%vehicle-images%'
      OR COALESCE(with_check, '') ILIKE '%vehicle-images%'
    );

  IF policy_count <> 4 THEN
    RAISE EXCEPTION 'unexpected legacy vehicle photo policy remains; found % policies', policy_count;
  END IF;
END;
$$;

ROLLBACK;