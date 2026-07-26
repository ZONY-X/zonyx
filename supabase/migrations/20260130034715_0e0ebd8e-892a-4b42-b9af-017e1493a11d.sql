-- Remove the policy that exposes user_id to the public
DROP POLICY IF EXISTS "Public can view approved host profiles" ON public.hosts;

-- The hosts_public view (already exists) is the correct way for public access
-- It only exposes: id, host_name, bio, avatar_url, created_at (NO user_id)