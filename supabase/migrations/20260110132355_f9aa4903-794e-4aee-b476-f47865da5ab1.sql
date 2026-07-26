-- Fix storage bucket: make private, add file restrictions
UPDATE storage.buckets 
SET public = false,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    file_size_limit = 5242880  -- 5MB in bytes
WHERE id = 'rental-images';

-- Drop existing permissive storage policies
DROP POLICY IF EXISTS "Anyone can view rental images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload rental images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update rental images" ON storage.objects;

-- Create authenticated storage policies with path-based access
CREATE POLICY "Authenticated users can view their rental images"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Authenticated users can upload their rental images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Authenticated users can update their rental images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Authenticated users can delete their rental images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'rental-images' 
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Create profiles table for user data
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = user_id);

-- Create trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update rental_images table to add user_id column
ALTER TABLE public.rental_images 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop existing rental_images policies
DROP POLICY IF EXISTS "Anyone can upload rental images" ON public.rental_images;
DROP POLICY IF EXISTS "Anyone can view rental images" ON public.rental_images;

-- Create authenticated rental_images policies
CREATE POLICY "Users can view their own rental images"
ON public.rental_images FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own rental images"
ON public.rental_images FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rental images"
ON public.rental_images FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own rental images"
ON public.rental_images FOR DELETE
USING (auth.uid() = user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add trigger to profiles
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();