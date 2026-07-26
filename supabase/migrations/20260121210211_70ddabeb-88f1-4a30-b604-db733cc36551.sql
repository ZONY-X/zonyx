-- Create guests table for renter-specific data (mirrors hosts structure)
CREATE TABLE public.guests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE,
    display_name text NOT NULL,
    bio text,
    avatar_url text,
    phone text,
    drivers_license_number text,
    drivers_license_expiry date,
    is_verified boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on guests table
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

-- RLS policies for guests table
CREATE POLICY "Guests can view their own profile"
ON public.guests
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Guests can insert their own profile"
ON public.guests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Guests can update their own profile"
ON public.guests
FOR UPDATE
USING (auth.uid() = user_id);

-- Create helper function to get guest_id from user_id (mirrors get_host_id)
CREATE OR REPLACE FUNCTION public.get_guest_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.guests WHERE user_id = _user_id LIMIT 1;
$$;

-- Create helper function to check if user is a guest
CREATE OR REPLACE FUNCTION public.is_guest(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.guests WHERE user_id = _user_id);
$$;

-- Create a public view for guests (excludes sensitive data)
CREATE VIEW public.guests_public AS
SELECT 
    id,
    display_name,
    avatar_url,
    created_at
FROM public.guests;

-- Update bookings table to reference guests table
ALTER TABLE public.bookings 
ADD COLUMN guest_id uuid REFERENCES public.guests(id);

-- Create trigger for updated_at on guests
CREATE TRIGGER update_guests_updated_at
BEFORE UPDATE ON public.guests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create guest_messages table (separate from host_messages)
CREATE TABLE public.guest_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_id uuid NOT NULL REFERENCES public.guests(id),
    sender_id uuid,
    booking_id uuid REFERENCES public.bookings(id),
    message text NOT NULL,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on guest_messages
ALTER TABLE public.guest_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for guest_messages
CREATE POLICY "Guests can view their messages"
ON public.guest_messages
FOR SELECT
USING ((guest_id = get_guest_id(auth.uid())) OR (sender_id = auth.uid()));

CREATE POLICY "Hosts can send messages to guests"
ON public.guest_messages
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Guests can update message read status"
ON public.guest_messages
FOR UPDATE
USING (guest_id = get_guest_id(auth.uid()));