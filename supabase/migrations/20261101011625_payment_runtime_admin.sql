-- Server-only runtime selection. Never import an environment default.
CREATE TABLE public.payment_runtime_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  active_provider text NOT NULL DEFAULT 'none' CHECK (active_provider IN ('none','square','paypal')),
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payment_processor_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  old_provider text NOT NULL,
  new_provider text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text CHECK (length(reason) <= 500)
);
ALTER TABLE public.payment_runtime_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_processor_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_runtime_config, public.payment_processor_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.payment_runtime_config TO service_role;
GRANT SELECT, INSERT ON public.payment_processor_audit TO service_role;
GRANT USAGE ON SEQUENCE public.payment_processor_audit_id_seq TO service_role;
INSERT INTO public.payment_runtime_config(id) VALUES (true);
-- Invoker function is service-role only. Row lock + version check + audit are atomic.
CREATE FUNCTION public.set_payment_runtime_provider(_actor uuid, _provider text, _expected_version integer, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE old public.payment_runtime_config;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.user_id WHERE p.user_id=_actor AND p.is_admin=true AND lower(p.email)='zoeysnp@gmail.com' AND lower(u.email)='zoeysnp@gmail.com') THEN
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
