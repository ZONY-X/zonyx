-- Add date_of_birth and id_photo_url columns to guests table
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS id_photo_url text;

-- Create storage bucket for guest ID photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('guest-id-photos', 'guest-id-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for guest avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('guest-avatars', 'guest-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for guest-id-photos bucket (private - only owner can access)
CREATE POLICY "Guests can upload their own ID photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'guest-id-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Guests can view their own ID photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'guest-id-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Guests can update their own ID photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'guest-id-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Guests can delete their own ID photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'guest-id-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- RLS policies for guest-avatars bucket (public read, owner write)
CREATE POLICY "Anyone can view guest avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'guest-avatars');

CREATE POLICY "Guests can upload their own avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'guest-avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Guests can update their own avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'guest-avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Guests can delete their own avatars"
ON storage.objects FOR DELETE
USING (bucket_id = 'guest-avatars' AND auth.uid()::text = (storage.foldername(name))[1]);