-- Keep auth.users inaccessible to service_role. Expose only the exact admin predicate
-- in a non-API schema; all runtime changes still use the atomic audited RPC.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
CREATE OR REPLACE FUNCTION private.payment_runtime_actor_is_admin(_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE='42501';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM _actor THEN
    RAISE EXCEPTION 'Actor mismatch' USING ERRCODE='42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.user_id
    WHERE p.user_id=_actor AND p.is_admin=true
      AND lower(p.email)='zoeysnp@gmail.com' AND lower(u.email)='zoeysnp@gmail.com'
  );
END;
$$;
REVOKE ALL ON FUNCTION private.payment_runtime_actor_is_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.payment_runtime_actor_is_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_payment_runtime_provider(_actor uuid, _provider text, _expected_version integer, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE old public.payment_runtime_config;
BEGIN
  IF NOT private.payment_runtime_actor_is_admin(_actor) THEN
    RAISE EXCEPTION 'Authoritative Admin required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT old FROM public.payment_runtime_config WHERE id=true FOR UPDATE;
  IF old.version <> _expected_version THEN RAISE EXCEPTION 'Configuration changed; refresh'; END IF;
  IF _provider NOT IN ('none','square','paypal') OR _provider IS NULL THEN RAISE EXCEPTION 'Unsupported processor'; END IF;
  UPDATE public.payment_runtime_config SET active_provider=_provider, version=version+1, updated_at=now() WHERE id=true;
  INSERT INTO public.payment_processor_audit(actor_user_id,old_provider,new_provider,reason) VALUES (_actor,old.active_provider,_provider,_reason);
  RETURN jsonb_build_object('active_provider',_provider,'version',old.version+1);
END;
$$;
REVOKE ALL ON FUNCTION public.set_payment_runtime_provider(uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_runtime_provider(uuid,text,integer,text) TO service_role;
