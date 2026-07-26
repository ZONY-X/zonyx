-- Create a public view that excludes sensitive fields (email, user_id)
CREATE VIEW public.hosts_public
WITH (security_invoker = on) AS
SELECT 
  id, 
  host_name, 
  bio, 
  avatar_url, 
  created_at
FROM public.hosts
WHERE is_approved = true;

-- Grant access to the public view
GRANT SELECT ON public.hosts_public TO anon, authenticated;

-- Drop the old policy that exposes all columns including email
DROP POLICY IF EXISTS "Anyone can view approved hosts" ON public.hosts;