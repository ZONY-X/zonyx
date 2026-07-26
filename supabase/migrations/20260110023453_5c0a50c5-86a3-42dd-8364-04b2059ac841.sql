-- Create storage bucket for rental images
INSERT INTO storage.buckets (id, name, public)
VALUES ('rental-images', 'rental-images', true);

-- Create table to track rental before/after images
CREATE TABLE public.rental_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rental_id UUID,
  image_type TEXT NOT NULL CHECK (image_type IN ('before', 'after')),
  image_url TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.rental_images ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view images (for demo purposes)
CREATE POLICY "Anyone can view rental images"
ON public.rental_images
FOR SELECT
USING (true);

-- Allow anyone to insert images (for demo purposes - in production, tie to auth)
CREATE POLICY "Anyone can upload rental images"
ON public.rental_images
FOR INSERT
WITH CHECK (true);

-- Storage policies for the bucket
CREATE POLICY "Anyone can view rental images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'rental-images');

CREATE POLICY "Anyone can upload rental images"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'rental-images');

CREATE POLICY "Anyone can update rental images"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'rental-images');