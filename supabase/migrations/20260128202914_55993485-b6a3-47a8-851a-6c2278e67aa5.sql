-- Create ratings table for trip reviews
CREATE TABLE public.ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  rater_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (booking_id, rater_id)
);

-- Enable RLS
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- Users can view ratings on their own bookings (as renter or host)
CREATE POLICY "Users can view ratings on their bookings"
ON public.ratings FOR SELECT
USING (
  rater_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_id
    AND (b.renter_id = auth.uid() OR b.host_id = get_host_id(auth.uid()))
  )
);

-- Users can create ratings for completed bookings they were part of
CREATE POLICY "Users can rate their completed bookings"
ON public.ratings FOR INSERT
WITH CHECK (
  rater_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_id
    AND b.status = 'completed'
    AND (b.renter_id = auth.uid() OR b.host_id = get_host_id(auth.uid()))
  )
);

-- Users can update their own ratings
CREATE POLICY "Users can update their own ratings"
ON public.ratings FOR UPDATE
USING (rater_id = auth.uid());

-- Users can delete their own ratings
CREATE POLICY "Users can delete their own ratings"
ON public.ratings FOR DELETE
USING (rater_id = auth.uid());

-- Add trigger for updated_at
CREATE TRIGGER update_ratings_updated_at
BEFORE UPDATE ON public.ratings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();