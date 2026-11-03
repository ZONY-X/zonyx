-- Additive PayPal vault, merchant-initiated transaction, and deposit-capture
-- preparation. All runtime activation remains explicitly disabled by default.
-- Only PayPal vault identifiers are stored; raw card data is never accepted.

CREATE TABLE public.paypal_payment_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'paypal' CHECK (provider='paypal'),
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  vault_token text NOT NULL,
  payer_reference text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  UNIQUE(provider,environment,vault_token)
);

CREATE TABLE public.paypal_payment_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_source_id uuid NOT NULL REFERENCES public.paypal_payment_sources(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('rental_payment','security_deposit','after_trip_charges')),
  categories text[] NOT NULL DEFAULT '{}',
  agreement_id uuid REFERENCES public.booking_rental_agreements(id) ON DELETE RESTRICT,
  terms_version text NOT NULL,
  consent_text_hash text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  CHECK (scope <> 'after_trip_charges' OR cardinality(categories) > 0),
  CHECK (revoked_at IS NULL OR revoked_reason IS NOT NULL)
);
CREATE INDEX paypal_payment_consents_profile_idx ON public.paypal_payment_consents(profile_id, consented_at DESC);
CREATE INDEX paypal_payment_consents_booking_idx ON public.paypal_payment_consents(booking_id, scope);

CREATE TABLE public.paypal_vault_requests (
  setup_token text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_source_id uuid REFERENCES public.paypal_payment_sources(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.paypal_mit_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'paypal' CHECK (provider='paypal'),
  payment_source_id uuid REFERENCES public.paypal_payment_sources(id) ON DELETE RESTRICT,
  deposit_id uuid REFERENCES public.booking_security_deposits(id) ON DELETE RESTRICT,
  after_trip_charge_id uuid REFERENCES public.after_trip_charges(id) ON DELETE RESTRICT,
  operation_type text NOT NULL CHECK (operation_type IN ('after_trip_charge','deposit_capture')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency='usd'),
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','dispatching','submitted','succeeded','failed','reconciliation_required')),
  provider_order_id text,
  provider_capture_id text,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  capture_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id),
  UNIQUE(provider, provider_order_id)
);

ALTER TABLE public.paypal_mit_operations
  ADD CONSTRAINT paypal_mit_operation_target_check CHECK (
    (operation_type='after_trip_charge' AND after_trip_charge_id IS NOT NULL AND deposit_id IS NULL) OR
    (operation_type='deposit_capture' AND deposit_id IS NOT NULL AND after_trip_charge_id IS NULL)
  );
ALTER TABLE public.paypal_mit_operations
  ADD CONSTRAINT paypal_mit_operation_source_check CHECK (
    (operation_type='after_trip_charge' AND payment_source_id IS NOT NULL) OR
    operation_type='deposit_capture'
  );
CREATE INDEX paypal_mit_operations_booking_idx ON public.paypal_mit_operations(booking_id, created_at);
CREATE UNIQUE INDEX paypal_mit_one_active_charge_idx ON public.paypal_mit_operations(after_trip_charge_id)
  WHERE after_trip_charge_id IS NOT NULL AND state NOT IN ('failed');

CREATE TABLE public.paypal_deposit_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id uuid NOT NULL REFERENCES public.booking_security_deposits(id) ON DELETE RESTRICT,
  mit_operation_id uuid NOT NULL UNIQUE REFERENCES public.paypal_mit_operations(id) ON DELETE RESTRICT,
  after_trip_charge_id uuid REFERENCES public.after_trip_charges(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  provider_capture_id text,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','pending','completed','denied','reversed','reconciliation_required')),
  final_capture boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deposit_id, provider_capture_id)
);

ALTER TABLE public.paypal_payment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypal_payment_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypal_vault_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypal_mit_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paypal_deposit_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paypal_payment_sources, public.paypal_payment_consents,
  public.paypal_vault_requests, public.paypal_mit_operations, public.paypal_deposit_captures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paypal_payment_sources, public.paypal_payment_consents,
  public.paypal_vault_requests, public.paypal_mit_operations, public.paypal_deposit_captures TO service_role;
GRANT SELECT ON public.paypal_payment_consents TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_paypal_mit_operation(_operation_id uuid)
RETURNS public.paypal_mit_operations LANGUAGE plpgsql SET search_path=public AS $$
DECLARE operation public.paypal_mit_operations%ROWTYPE;
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  UPDATE public.paypal_mit_operations
  SET state='dispatching', updated_at=now()
  WHERE id=_operation_id AND state='prepared'
  RETURNING * INTO operation;
  IF operation.id IS NULL THEN RAISE EXCEPTION 'Operation already claimed or unavailable'; END IF;
  RETURN operation;
END; $$;

CREATE OR REPLACE FUNCTION public.record_paypal_mit_capture(
  _operation_id uuid, _capture_id text, _status text, _provider_order_id text DEFAULT NULL
) RETURNS public.paypal_mit_operations LANGUAGE plpgsql SET search_path=public AS $$
DECLARE operation public.paypal_mit_operations%ROWTYPE;
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF _status NOT IN ('succeeded','failed','reconciliation_required') OR NULLIF(_capture_id,'') IS NULL THEN
    RAISE EXCEPTION 'Provider capture evidence required';
  END IF;
  UPDATE public.paypal_mit_operations
  SET state=_status, provider_capture_id=_capture_id,
      provider_order_id=COALESCE(_provider_order_id,provider_order_id), updated_at=now()
  WHERE id=_operation_id AND state IN ('dispatching','submitted','reconciliation_required')
  RETURNING * INTO operation;
  IF operation.id IS NULL THEN RAISE EXCEPTION 'Operation identity or state conflict'; END IF;
  RETURN operation;
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_paypal_payment_consent(
  _consent_id uuid, _profile_id uuid, _reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=_profile_id AND user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Consent owner required';
  END IF;
  IF length(btrim(COALESCE(_reason,''))) < 5 THEN RAISE EXCEPTION 'Revocation reason required'; END IF;
  UPDATE public.paypal_payment_consents
  SET revoked_at=COALESCE(revoked_at,now()), revoked_reason=COALESCE(revoked_reason,btrim(_reason))
  WHERE id=_consent_id AND profile_id=_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consent not found'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.revoke_paypal_payment_consent(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_paypal_payment_consent(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_paypal_mit_operation(
  _operation_id uuid, _capture_id text, _amount_cents bigint, _currency text
) RETURNS public.paypal_mit_operations LANGUAGE plpgsql SET search_path=public AS $$
DECLARE operation public.paypal_mit_operations%ROWTYPE; charge public.after_trip_charges%ROWTYPE;
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO operation FROM public.paypal_mit_operations WHERE id=_operation_id FOR UPDATE;
  IF operation.state='succeeded' AND operation.provider_capture_id=_capture_id THEN RETURN operation; END IF;
  IF operation.id IS NULL OR operation.operation_type<>'after_trip_charge' OR operation.amount_cents<>_amount_cents
    OR operation.currency<>_currency OR operation.state NOT IN ('dispatching','submitted','reconciliation_required') THEN
    RAISE EXCEPTION 'MIT operation integrity failure';
  END IF;
  SELECT * INTO charge FROM public.after_trip_charges WHERE id=operation.after_trip_charge_id FOR UPDATE;
  IF charge.id IS NULL OR charge.booking_id<>operation.booking_id OR charge.amount_cents<>_amount_cents THEN
    RAISE EXCEPTION 'After-trip charge integrity failure';
  END IF;
  PERFORM set_config('app.after_trip_admin_transition','allowed',true);
  UPDATE public.after_trip_charges SET status='paid',payment_status='paid',status_changed_at=now() WHERE id=charge.id;
  INSERT INTO public.booking_financial_ledger(
    booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,
    status,source,external_reference,description,occurred_at,created_by_profile_id,metadata
  ) VALUES (
    charge.booking_id,NULL,'paypal-mit:'||operation.id,'after_trip_payment',charge.category,
    _amount_cents,_currency,'payment','succeeded','paypal_mit',_capture_id,
    charge.explanation,now(),charge.created_by_profile_id,
    jsonb_build_object('payment_source_id',operation.payment_source_id,'mit_operation_id',operation.id)
  ) ON CONFLICT (stable_key) DO NOTHING;
  UPDATE public.paypal_mit_operations SET state='succeeded',provider_capture_id=_capture_id,updated_at=now()
    WHERE id=operation.id RETURNING * INTO operation;
  RETURN operation;
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_paypal_deposit_capture(
  _operation_id uuid, _capture_id text, _amount_cents bigint, _currency text, _final_capture boolean
) RETURNS public.paypal_mit_operations LANGUAGE plpgsql SET search_path=public AS $$
DECLARE operation public.paypal_mit_operations%ROWTYPE; deposit public.booking_security_deposits%ROWTYPE; remaining bigint;
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO operation FROM public.paypal_mit_operations WHERE id=_operation_id FOR UPDATE;
  IF operation.state='succeeded' AND operation.provider_capture_id=_capture_id THEN RETURN operation; END IF;
  SELECT * INTO deposit FROM public.booking_security_deposits WHERE id=operation.deposit_id FOR UPDATE;
  IF operation.id IS NULL OR operation.operation_type<>'deposit_capture' OR operation.amount_cents<>_amount_cents
    OR operation.currency<>_currency OR operation.state NOT IN ('dispatching','submitted','reconciliation_required')
    OR deposit.id IS NULL OR deposit.provider_authorization_id IS NULL THEN
    RAISE EXCEPTION 'Deposit capture integrity failure';
  END IF;
  IF operation.after_trip_charge_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.after_trip_charges
    WHERE id=operation.after_trip_charge_id AND booking_id=deposit.booking_id
      AND amount_cents=_amount_cents AND payment_status<>'paid'
  ) THEN RAISE EXCEPTION 'Deposit capture charge integrity failure'; END IF;
  remaining:=deposit.amount_cents-deposit.captured_amount_cents;
  IF _amount_cents>remaining OR (_final_capture AND _amount_cents<>remaining) THEN
    RAISE EXCEPTION 'Deposit capture exceeds remaining authorization';
  END IF;
  INSERT INTO public.paypal_deposit_captures(
    deposit_id,mit_operation_id,after_trip_charge_id,amount_cents,provider_capture_id,status,final_capture
  ) VALUES (
    deposit.id,operation.id,operation.after_trip_charge_id,_amount_cents,_capture_id,'completed',_final_capture
  ) ON CONFLICT (mit_operation_id) DO NOTHING;
  UPDATE public.booking_security_deposits
  SET captured_amount_cents=captured_amount_cents+_amount_cents,
      status=CASE WHEN _final_capture OR captured_amount_cents+_amount_cents=amount_cents THEN 'captured' ELSE 'partially_captured' END
  WHERE id=deposit.id;
  IF operation.after_trip_charge_id IS NOT NULL THEN
    PERFORM set_config('app.after_trip_admin_transition','allowed',true);
    UPDATE public.after_trip_charges SET status='paid',payment_status='paid',status_changed_at=now()
      WHERE id=operation.after_trip_charge_id;
  END IF;
  INSERT INTO public.booking_financial_ledger(
    booking_id,reconciliation_id,stable_key,entry_type,category,amount_cents,currency,effect,
    status,source,external_reference,description,occurred_at,created_by_profile_id,metadata
  ) VALUES (
    deposit.booking_id,NULL,'paypal-deposit-capture:'||operation.id,'deposit_capture','security_deposit',
    _amount_cents,_currency,'deposit_capture','succeeded','paypal_mit',_capture_id,
    'PayPal security deposit capture',now(),
    (SELECT renter_profile_id FROM public.bookings WHERE id=deposit.booking_id),
    jsonb_build_object('mit_operation_id',operation.id,'final_capture',_final_capture)
  ) ON CONFLICT (stable_key) DO NOTHING;
  UPDATE public.paypal_mit_operations SET state='succeeded',provider_capture_id=_capture_id,updated_at=now()
    WHERE id=operation.id RETURNING * INTO operation;
  RETURN operation;
END; $$;

REVOKE EXECUTE ON FUNCTION public.claim_paypal_mit_operation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_paypal_mit_capture(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_paypal_mit_operation(uuid, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_paypal_deposit_capture(uuid, text, bigint, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paypal_mit_operation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_paypal_mit_capture(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_paypal_mit_operation(uuid, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_paypal_deposit_capture(uuid, text, bigint, text, boolean) TO service_role;
