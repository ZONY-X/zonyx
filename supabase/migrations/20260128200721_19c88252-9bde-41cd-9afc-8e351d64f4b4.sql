-- Fix "Unknown host" by making public profile views evaluate with view-owner privileges
-- (so underlying table RLS doesn't blank out results for guests/hosts)
ALTER VIEW IF EXISTS public.hosts_public SET (security_invoker = false);
ALTER VIEW IF EXISTS public.guests_public SET (security_invoker = false);

-- Tighten view privileges: read-only
REVOKE ALL ON TABLE public.hosts_public FROM anon, authenticated;
GRANT SELECT ON TABLE public.hosts_public TO anon, authenticated;

REVOKE ALL ON TABLE public.guests_public FROM anon, authenticated;
GRANT SELECT ON TABLE public.guests_public TO anon, authenticated;