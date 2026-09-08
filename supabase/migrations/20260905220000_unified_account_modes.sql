-- Module 3B: authoritative account capabilities for one-account marketplace modes.
-- Client-selected mode never grants permissions; existing RLS/RPC checks remain authoritative.

CREATE OR REPLACE FUNCTION public.current_profile_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT p.is_admin
        AND lower(p.email) = 'zoeysnp@gmail.com'
        AND lower(u.email) = 'zoeysnp@gmail.com'
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.user_id
      WHERE p.user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.current_profile_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_profile_is_admin() TO anon, authenticated, service_role;

-- Enforce the unique administrator invariant at the data boundary as well.
UPDATE public.profiles p
SET is_admin = CASE
  WHEN lower(p.email) = 'zoeysnp@gmail.com'
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id AND lower(u.email) = 'zoeysnp@gmail.com')
  THEN true
  ELSE false
END
WHERE p.is_admin IS DISTINCT FROM CASE
  WHEN lower(p.email) = 'zoeysnp@gmail.com'
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id AND lower(u.email) = 'zoeysnp@gmail.com')
  THEN true
  ELSE false
END;

CREATE OR REPLACE FUNCTION public.protect_profile_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_is_unique_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(COALESCE(u.email, '')) = 'zoeysnp@gmail.com'
    AND lower(COALESCE(NEW.email, '')) = 'zoeysnp@gmail.com'
  INTO target_is_unique_admin
  FROM auth.users u
  WHERE u.id = NEW.user_id;

  IF NEW.is_admin AND NOT COALESCE(target_is_unique_admin, false) THEN
    RAISE EXCEPTION 'This account is not authorized for platform administration.';
  END IF;

  IF public.current_profile_is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'Only the authorized platform administrator can change admin status.';
  END IF;

  IF NEW.is_host IS DISTINCT FROM OLD.is_host THEN
    RAISE EXCEPTION 'Host status can only be changed through a trusted approval flow.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_account_capabilities()
RETURNS TABLE (
  profile_id uuid,
  full_name text,
  email text,
  can_guest boolean,
  can_host boolean,
  can_admin boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    p.id,
    p.full_name,
    p.email,
    true,
    p.is_host,
    p.is_admin
      AND lower(p.email) = 'zoeysnp@gmail.com'
      AND lower(u.email) = 'zoeysnp@gmail.com'
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_account_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_capabilities() TO authenticated, service_role;