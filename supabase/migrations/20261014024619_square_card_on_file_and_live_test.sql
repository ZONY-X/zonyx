-- Independent live $1 obligation; no booking, renewal plan or deposit is created.
CREATE TABLE public.square_live_test_checkouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32),'hex'),
 description text NOT NULL DEFAULT 'ZONYX PAY - LIVE $1 payment test',
 amount_cents bigint NOT NULL DEFAULT 100 CHECK(amount_cents=100),
 currency text NOT NULL DEFAULT 'usd' CHECK(currency='usd'),
 enabled boolean NOT NULL DEFAULT true,
 payment_status text NOT NULL DEFAULT 'payment_due' CHECK(payment_status IN('payment_due','processing','paid')),
 square_payment_id text UNIQUE, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.square_live_test_checkouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_live_test_checkouts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.square_live_test_checkouts TO service_role;
ALTER TABLE public.square_renewal_payment_attempts ALTER COLUMN period_id DROP NOT NULL, ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE public.square_renewal_payment_attempts ADD COLUMN test_id uuid REFERENCES public.square_live_test_checkouts(id);
ALTER TABLE public.square_renewal_payment_attempts ADD CONSTRAINT square_checkout_single_obligation CHECK((test_id IS NULL AND period_id IS NOT NULL AND booking_id IS NOT NULL) OR(test_id IS NOT NULL AND period_id IS NULL AND booking_id IS NULL));
CREATE UNIQUE INDEX square_live_test_one_active ON public.square_renewal_payment_attempts(test_id) WHERE state IN('processing','reconciliation_required','paid');
CREATE TABLE public.square_checkout_authorizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL UNIQUE REFERENCES public.square_renewal_payment_attempts(id),
 submission_id uuid NOT NULL UNIQUE,
 booking_id uuid REFERENCES public.bookings(id), test_id uuid REFERENCES public.square_live_test_checkouts(id),
 payer_given_name text NOT NULL CHECK(length(payer_given_name) BETWEEN 1 AND 80),
 payer_family_name text NOT NULL CHECK(length(payer_family_name) BETWEEN 1 AND 80),
 payer_email text NOT NULL CHECK(length(payer_email) BETWEEN 3 AND 254),
 postal_code text NOT NULL CHECK(length(postal_code) BETWEEN 2 AND 16),
 country text NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
 terms_version text NOT NULL, terms_text text NOT NULL, terms_sha256 text NOT NULL,
 terms_context jsonb NOT NULL,
 storage_consent boolean NOT NULL CHECK(storage_consent), future_charge_consent boolean NOT NULL CHECK(future_charge_consent),
 accepted_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','active','withdrawn')),
 card_state text NOT NULL DEFAULT 'pending' CHECK(card_state IN('pending','verified','error','disabled')),
 square_customer_id text, square_card_id text, card_last4 text CHECK(card_last4 ~ '^[0-9]{4}$'), card_brand text,
 verified_at timestamptz, withdrawn_at timestamptz,
 management_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32),'hex'),
 dispatch_started_at timestamptz,
 receipt_sent_at timestamptz,
 CHECK((booking_id IS NULL)<>(test_id IS NULL))
);
ALTER TABLE public.square_checkout_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_checkout_authorizations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.square_checkout_authorizations TO service_role;
CREATE TABLE public.square_checkout_authorization_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), authorization_id uuid NOT NULL REFERENCES public.square_checkout_authorizations(id),
 event_type text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.square_checkout_authorization_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_checkout_authorization_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.square_checkout_authorization_events TO service_role;
ALTER TABLE public.square_renewal_payment_attempts ADD COLUMN source_authorization_id uuid REFERENCES public.square_checkout_authorizations(id);

CREATE FUNCTION public.get_square_live_test_details(_token text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.square_live_test_checkouts%ROWTYPE; a public.square_renewal_payment_attempts%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO t FROM public.square_live_test_checkouts WHERE token=_token AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment link unavailable.'; END IF;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE test_id=t.id ORDER BY generation DESC LIMIT 1;
 RETURN jsonb_build_object('test_id',t.id,'description',t.description,'reservation_number','INDEPENDENT LIVE TEST','amount_cents',t.amount_cents,'currency',t.currency,'payment_status',t.payment_status,'paid_at',t.paid_at,'can_pay',t.payment_status<>'paid','checkout_state',a.state,'public_link',true,'live_test',true);
END $$;
REVOKE ALL ON FUNCTION public.get_square_live_test_details(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_square_live_test_details(text) TO service_role;

CREATE FUNCTION public.prepare_square_cof_checkout(_kind text,_link text,_submission_id uuid,_payer jsonb,_terms_version text,_terms_text text,_terms_context jsonb,_storage_consent boolean,_future_consent boolean,_location_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.square_renewal_payment_attempts%ROWTYPE; t public.square_live_test_checkouts%ROWTYPE; prepared jsonb; c public.square_checkout_authorizations%ROWTYPE; n integer;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 IF _storage_consent IS DISTINCT FROM true OR _future_consent IS DISTINCT FROM true OR _terms_version<>'zonyx-square-cof-v1' OR length(_terms_text)<100 OR _submission_id IS NULL THEN RAISE EXCEPTION 'Explicit card storage and future-charge authorization are required.'; END IF;
 IF length(btrim(COALESCE(_payer->>'givenName',''))) NOT BETWEEN 1 AND 80 OR length(btrim(COALESCE(_payer->>'familyName',''))) NOT BETWEEN 1 AND 80 OR COALESCE(_payer->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(_payer->>'email')>254 OR length(COALESCE(_payer->>'postalCode','')) NOT BETWEEN 2 AND 16 OR COALESCE(_payer->>'country','') !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Cardholder name, email, billing postal code and country are required.'; END IF;
 IF _kind='renewal' THEN
  prepared:=public.prepare_public_square_renewal_payment(_link,'live',_location_id);
  IF COALESCE((prepared->>'already_paid')::boolean,false) THEN RETURN prepared; END IF;
  SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE id=(prepared->>'id')::uuid FOR UPDATE;
 ELSIF _kind='live_test' THEN
  SELECT * INTO t FROM public.square_live_test_checkouts WHERE token=_link AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment link unavailable.'; END IF;
  IF t.payment_status='paid' THEN RETURN jsonb_build_object('already_paid',true); END IF;
  SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE test_id=t.id AND state IN('processing','reconciliation_required','paid') FOR UPDATE;
  IF NOT FOUND THEN
   SELECT COALESCE(max(generation),0)+1 INTO n FROM public.square_renewal_payment_attempts WHERE test_id=t.id;
   INSERT INTO public.square_renewal_payment_attempts(test_id,generation,amount_cents,currency,environment,location_id) VALUES(t.id,n,100,'usd','live',_location_id) RETURNING * INTO a;
  END IF;
 ELSE RAISE EXCEPTION 'Unsupported payment obligation.';
 END IF;
 SELECT * INTO c FROM public.square_checkout_authorizations WHERE attempt_id=a.id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public.square_checkout_authorizations(attempt_id,submission_id,booking_id,test_id,payer_given_name,payer_family_name,payer_email,postal_code,country,terms_version,terms_text,terms_sha256,terms_context,storage_consent,future_charge_consent)
  VALUES(a.id,_submission_id,a.booking_id,a.test_id,btrim(_payer->>'givenName'),btrim(_payer->>'familyName'),lower(btrim(_payer->>'email')),_payer->>'postalCode',_payer->>'country',_terms_version,_terms_text,encode(extensions.digest(_terms_text,'sha256'),'hex'),_terms_context,true,true) RETURNING * INTO c;
  INSERT INTO public.square_checkout_authorization_events(authorization_id,event_type,details) VALUES(c.id,'consent_accepted',jsonb_build_object('terms_sha256',c.terms_sha256,'submission_id',_submission_id));
 ELSIF c.submission_id<>_submission_id THEN
  RETURN to_jsonb(a)||jsonb_build_object('dispatch',false,'different_submission',true);
 ELSIF c.payer_email<>lower(btrim(_payer->>'email')) OR c.payer_given_name<>btrim(_payer->>'givenName') OR c.payer_family_name<>btrim(_payer->>'familyName') OR c.postal_code<>_payer->>'postalCode' OR c.country<>_payer->>'country' THEN RAISE EXCEPTION 'Existing payment consent cannot be replaced.';
 END IF;
 IF a.location_id<>_location_id OR a.environment<>'live' THEN RAISE EXCEPTION 'Square payment environment conflicts.'; END IF;
 RETURN to_jsonb(a)||jsonb_build_object('authorization_id',c.id,'dispatch',c.dispatch_started_at IS NULL AND c.state<>'withdrawn');
END $$;
REVOKE ALL ON FUNCTION public.prepare_square_cof_checkout(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_square_cof_checkout(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text) TO service_role;

CREATE FUNCTION public.claim_square_cof_dispatch(_authorization_id uuid,_submission_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.square_checkout_authorizations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO c FROM public.square_checkout_authorizations WHERE id=_authorization_id FOR UPDATE;
 IF NOT FOUND OR c.submission_id<>_submission_id OR c.state='withdrawn' OR c.square_customer_id IS NULL THEN RAISE EXCEPTION 'Valid payer consent and Square customer required.'; END IF;
 IF c.dispatch_started_at IS NOT NULL THEN RETURN false; END IF;
 UPDATE public.square_checkout_authorizations SET dispatch_started_at=now() WHERE id=c.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_square_cof_dispatch(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_square_cof_dispatch(uuid,uuid) TO service_role;

CREATE FUNCTION public.record_square_checkout_payment(_attempt_id uuid,_payment_id text,_amount_cents bigint,_location_id text,_environment text,_status text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.square_renewal_payment_attempts%ROWTYPE; t public.square_live_test_checkouts%ROWTYPE; next_state text;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE id=_attempt_id;
 IF a.test_id IS NULL THEN RETURN public.record_square_renewal_payment(_attempt_id,_payment_id,_amount_cents,_location_id,_environment,_status); END IF;
 SELECT * INTO t FROM public.square_live_test_checkouts WHERE id=a.test_id FOR UPDATE;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE id=_attempt_id FOR UPDATE;
 IF a.amount_cents IS DISTINCT FROM _amount_cents OR _amount_cents<>100 OR a.location_id IS DISTINCT FROM _location_id OR _environment<>'live' OR a.environment<>_environment OR (a.provider_payment_id IS NOT NULL AND a.provider_payment_id IS DISTINCT FROM _payment_id) THEN RAISE EXCEPTION 'Square test payment evidence conflicts.'; END IF;
 IF _status NOT IN('COMPLETED','PENDING','APPROVED','FAILED','CANCELED','UNKNOWN') THEN RAISE EXCEPTION 'Invalid payment status.'; END IF;
 IF _status NOT IN('FAILED','UNKNOWN') AND COALESCE(_payment_id,'')='' THEN RAISE EXCEPTION 'Canonical Square payment identity required.'; END IF;
 IF a.state='paid' THEN RETURN jsonb_build_object('already_paid',true,'state','paid'); END IF;
 next_state:=CASE _status WHEN 'COMPLETED' THEN 'paid' WHEN 'FAILED' THEN 'failed' WHEN 'CANCELED' THEN 'canceled' WHEN 'UNKNOWN' THEN 'reconciliation_required' ELSE 'processing' END;
 UPDATE public.square_renewal_payment_attempts SET state=next_state,provider_payment_id=COALESCE(_payment_id,provider_payment_id),settled_at=CASE WHEN next_state='paid' THEN now() ELSE settled_at END WHERE id=a.id;
 UPDATE public.square_live_test_checkouts SET payment_status=CASE WHEN next_state='paid' THEN 'paid' WHEN next_state IN('processing','reconciliation_required') THEN 'processing' ELSE 'payment_due' END,square_payment_id=CASE WHEN next_state='paid' THEN _payment_id ELSE square_payment_id END,paid_at=CASE WHEN next_state='paid' THEN COALESCE(paid_at,now()) ELSE paid_at END WHERE id=t.id;
 RETURN jsonb_build_object('state',next_state,'test_id',t.id);
END $$;
REVOKE ALL ON FUNCTION public.record_square_checkout_payment(uuid,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_square_checkout_payment(uuid,text,bigint,text,text,text) TO service_role;

CREATE FUNCTION public.confirm_square_checkout_card(_authorization_id uuid,_customer_id text,_card_id text,_last4 text,_brand text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.square_checkout_authorizations%ROWTYPE; a public.square_renewal_payment_attempts%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO c FROM public.square_checkout_authorizations WHERE id=_authorization_id FOR UPDATE;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE id=c.attempt_id;
 IF NOT FOUND OR a.state<>'paid' OR c.square_customer_id IS DISTINCT FROM _customer_id OR COALESCE(_card_id,'') NOT LIKE 'ccof:%' OR _last4 !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'Confirmed Square card and completed payment required.'; END IF;
 IF c.square_card_id IS NOT NULL AND c.square_card_id<>_card_id THEN RAISE EXCEPTION 'Saved card identity cannot be replaced.'; END IF;
 UPDATE public.square_checkout_authorizations SET square_card_id=_card_id,card_last4=_last4,card_brand=_brand,card_state='verified',state=CASE WHEN state='withdrawn' THEN 'withdrawn' ELSE 'active' END,verified_at=COALESCE(verified_at,now()) WHERE id=c.id;
 IF c.square_card_id IS NULL THEN INSERT INTO public.square_checkout_authorization_events(authorization_id,event_type,details) VALUES(c.id,'square_card_verified',jsonb_build_object('customer_id',_customer_id,'card_id',_card_id)); END IF;
END $$;
REVOKE ALL ON FUNCTION public.confirm_square_checkout_card(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_square_checkout_card(uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.withdraw_square_checkout_authorization(_management_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.square_checkout_authorizations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO c FROM public.square_checkout_authorizations WHERE management_token=_management_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Authorization unavailable.'; END IF;
 IF c.state<>'withdrawn' THEN
  UPDATE public.square_checkout_authorizations SET state='withdrawn',withdrawn_at=now() WHERE id=c.id;
  INSERT INTO public.square_checkout_authorization_events(authorization_id,event_type) VALUES(c.id,'authorization_withdrawn');
 END IF;
 RETURN jsonb_build_object('id',c.id,'card_id',c.square_card_id,'customer_id',c.square_customer_id,'withdrawn',true);
END $$;
REVOKE ALL ON FUNCTION public.withdraw_square_checkout_authorization(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_square_checkout_authorization(text) TO service_role;

-- Merchant-initiated renewals are bound to an active authorization and server-owned, due period.
CREATE FUNCTION public.prepare_square_authorized_renewal(_authorization_id uuid,_period_id uuid,_admin_user_id uuid,_location_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.square_checkout_authorizations%ROWTYPE; p public.rental_extension_periods%ROWTYPE; guest_user uuid; prepared jsonb; a public.square_renewal_payment_attempts%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=_admin_user_id AND is_admin) THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 SELECT * INTO c FROM public.square_checkout_authorizations WHERE id=_authorization_id FOR UPDATE;
 IF c.id IS NULL OR c.state<>'active' OR c.card_state<>'verified' OR c.withdrawn_at IS NOT NULL OR NOT c.future_charge_consent OR c.booking_id IS NULL OR c.square_customer_id IS NULL OR c.square_card_id IS NULL THEN RAISE EXCEPTION 'Active reservation-specific future-charge authorization required.'; END IF;
 SELECT * INTO p FROM public.rental_extension_periods WHERE id=_period_id;
 IF p.id IS NULL OR p.booking_id<>c.booking_id OR p.billing_reminder_date>current_date THEN RAISE EXCEPTION 'Only a due rental period from the authorized reservation may be charged.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c.terms_context->'rental_schedule','[]'::jsonb)) x WHERE x->>'period_start'=p.period_start::text AND x->>'period_end'=p.period_end::text AND (x->>'amount_cents')::bigint=p.amount_due_cents AND x->>'billing_date'=p.billing_reminder_date::text AND x->>'currency'=p.currency) THEN RAISE EXCEPTION 'This amount or schedule was not included in the recorded authorization. New authorization required.'; END IF;
 SELECT pr.user_id INTO guest_user FROM public.bookings b JOIN public.profiles pr ON pr.id=b.renter_profile_id WHERE b.id=c.booking_id;
 prepared:=public.prepare_square_renewal_payment(p.id,guest_user,'live',_location_id);
 IF COALESCE((prepared->>'already_paid')::boolean,false) THEN RETURN prepared; END IF;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE id=(prepared->>'id')::uuid FOR UPDATE;
 IF COALESCE((prepared->>'dispatch')::boolean,false) THEN
  UPDATE public.square_renewal_payment_attempts SET source_authorization_id=c.id,created_by_profile_id=(SELECT id FROM public.profiles WHERE user_id=_admin_user_id AND is_admin) WHERE id=a.id;
 ELSIF a.source_authorization_id IS DISTINCT FROM c.id THEN RAISE EXCEPTION 'Another payment already exists. Reconcile it instead of charging again.';
 END IF;
 RETURN prepared||jsonb_build_object('source_authorization_id',c.id,'square_customer_id',c.square_customer_id,'square_card_id',c.square_card_id);
END $$;
REVOKE ALL ON FUNCTION public.prepare_square_authorized_renewal(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_square_authorized_renewal(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.get_square_checkout_authorization_context(_kind text,_link text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.rental_extension_periods%ROWTYPE; agreement uuid; revision uuid; doc_hash text; periods jsonb;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 IF _kind='live_test' THEN
  IF NOT EXISTS(SELECT 1 FROM public.square_live_test_checkouts WHERE token=_link AND enabled) THEN RAISE EXCEPTION 'Payment link unavailable.'; END IF;
  RETURN jsonb_build_object('scope','independent_live_test','authorized_reservation',NULL,'automatic_future_test_charges',false);
 END IF;
 SELECT x.* INTO p FROM public.rental_extension_periods x JOIN public.square_renewal_payment_links l ON l.period_id=x.id WHERE l.token=_link AND l.enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment link unavailable.'; END IF;
 SELECT a.id,a.document_hash INTO agreement,doc_hash FROM public.booking_rental_agreements a WHERE a.booking_id=p.booking_id ORDER BY a.created_at DESC LIMIT 1;
 SELECT r.id,r.document_hash INTO revision,doc_hash FROM public.rental_agreement_current_revisions c JOIN public.rental_agreement_revisions r ON r.id=c.revision_id WHERE c.booking_id=p.booking_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('period_start',x.period_start,'period_end',x.period_end,'amount_cents',x.amount_due_cents,'currency',x.currency,'billing_date',x.billing_reminder_date) ORDER BY x.period_start),'[]'::jsonb) INTO periods FROM public.rental_extension_periods x JOIN public.rental_extension_plans pl ON pl.id=x.extension_plan_id WHERE x.booking_id=p.booking_id AND pl.status='active';
 RETURN jsonb_build_object('booking_id',p.booking_id,'agreement_id',agreement,'revision_id',revision,'document_hash',doc_hash,'rental_schedule',periods);
END $$;
REVOKE ALL ON FUNCTION public.get_square_checkout_authorization_context(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_square_checkout_authorization_context(text,text) TO service_role;

CREATE FUNCTION public.guard_square_checkout_authorization() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.id,NEW.attempt_id,NEW.submission_id,NEW.booking_id,NEW.test_id,NEW.payer_given_name,NEW.payer_family_name,NEW.payer_email,NEW.postal_code,NEW.country,NEW.terms_version,NEW.terms_text,NEW.terms_sha256,NEW.terms_context,NEW.storage_consent,NEW.future_charge_consent,NEW.accepted_at,NEW.management_token) IS DISTINCT FROM ROW(OLD.id,OLD.attempt_id,OLD.submission_id,OLD.booking_id,OLD.test_id,OLD.payer_given_name,OLD.payer_family_name,OLD.payer_email,OLD.postal_code,OLD.country,OLD.terms_version,OLD.terms_text,OLD.terms_sha256,OLD.terms_context,OLD.storage_consent,OLD.future_charge_consent,OLD.accepted_at,OLD.management_token) THEN RAISE EXCEPTION 'Accepted payer authorization is immutable.'; END IF;
 IF OLD.state='withdrawn' AND NEW.state<>'withdrawn' THEN RAISE EXCEPTION 'Withdrawn authorization cannot be reactivated.'; END IF;
 IF (OLD.square_customer_id IS NOT NULL AND NEW.square_customer_id IS DISTINCT FROM OLD.square_customer_id) OR (OLD.square_card_id IS NOT NULL AND NEW.square_card_id IS DISTINCT FROM OLD.square_card_id) THEN RAISE EXCEPTION 'Square customer and card identity cannot be replaced.'; END IF;
 IF NEW.state='active' AND (NEW.card_state<>'verified' OR NEW.square_card_id IS NULL OR NEW.square_customer_id IS NULL OR NEW.verified_at IS NULL) THEN RAISE EXCEPTION 'Confirmed Square card required for active authorization.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_square_checkout_authorization BEFORE UPDATE ON public.square_checkout_authorizations FOR EACH ROW EXECUTE FUNCTION public.guard_square_checkout_authorization();
