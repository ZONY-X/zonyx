-- Fix security definer view issue - drop and recreate without security definer
DROP VIEW IF EXISTS public.guests_public;

-- Recreate as a regular view (inherits caller's permissions)
CREATE VIEW public.guests_public 
WITH (security_invoker = true)
AS
SELECT 
    id,
    display_name,
    avatar_url,
    created_at
FROM public.guests;

-- Fix overly permissive INSERT policy on guest_messages
DROP POLICY IF EXISTS "Hosts can send messages to guests" ON public.guest_messages;

-- Create a more restrictive policy - only hosts can send messages to guests
CREATE POLICY "Hosts can send messages to guests"
ON public.guest_messages
FOR INSERT
WITH CHECK (
    -- Sender must be authenticated
    auth.uid() IS NOT NULL 
    AND 
    -- Sender must be an approved host
    is_host(auth.uid())
);