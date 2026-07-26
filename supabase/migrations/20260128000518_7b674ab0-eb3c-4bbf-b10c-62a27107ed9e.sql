-- Create policies for guest-id-photos bucket
-- Allow authenticated users to upload their own ID photos
CREATE POLICY "Users can upload their own ID photos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'guest-id-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to update/replace their own ID photos
CREATE POLICY "Users can update their own ID photos"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'guest-id-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to view their own ID photos
CREATE POLICY "Users can view their own ID photos"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'guest-id-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to delete their own ID photos
CREATE POLICY "Users can delete their own ID photos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'guest-id-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);