-- Additive account access and guest handover guard. No payment objects or processor calls.
BEGIN;
CREATE SCHEMA guest_checkout_private;
REVOKE ALL ON SCHEMA guest_checkout_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA guest_checkout_private TO service_role;

CREATE TABLE guest_checkout_private.contacts (
  guest_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 150),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254 AND email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
  phone text NOT NULL CHECK (length(phone) BETWEEN 7 AND 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE guest_checkout_private.invitations (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE RESTRICT,
  guest_user_id uuid NOT NULL REFERENCES guest_checkout_private.contacts(guest_user_id),
  email text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE guest_checkout_private.account_access (
  booking_id uuid PRIMARY KEY REFERENCES guest_checkout_private.invitations(booking_id),
  customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_invitation_email_idx ON guest_checkout_private.invitations(email);
CREATE INDEX guest_access_customer_idx ON guest_checkout_private.account_access(customer_user_id);
CREATE TABLE guest_checkout_private.handover_verifications (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE RESTRICT,
  verified_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  verified_at timestamptz NOT NULL DEFAULT now(),
  identity_checked boolean NOT NULL CHECK(identity_checked),
  license_checked boolean NOT NULL CHECK(license_checked)
);
ALTER TABLE guest_checkout_private.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_checkout_private.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_checkout_private.account_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_checkout_private.handover_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA guest_checkout_private FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA guest_checkout_private TO service_role;

-- Only these helpers need the migration owner's Auth privileges; public RPCs
-- remain invokers and cannot expose Auth rows to browser roles.
DO $$
BEGIN
  IF NOT has_schema_privilege(current_user, 'auth', 'USAGE')
    OR NOT has_table_privilege(current_user, 'auth.users', 'SELECT')
    OR NOT has_table_privilege(current_user, 'auth.users', 'UPDATE')
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_roles r ON r.rolname=current_user
      WHERE c.oid='auth.users'::regclass
        AND (NOT c.relrowsecurity OR r.rolsuper OR r.rolbypassrls
          OR (NOT c.relforcerowsecurity AND pg_catalog.pg_has_role(current_user,c.relowner,'USAGE')))
    ) THEN
    RAISE EXCEPTION 'Migration owner requires Auth table access and RLS bypass for guest identity helpers';
  END IF;
END; $$;

CREATE FUNCTION guest_checkout_private.lock_anonymous_user(_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM auth.users u WHERE u.id=_user_id AND u.is_anonymous IS TRUE FOR UPDATE;
  RETURN FOUND;
END; $$;

CREATE FUNCTION guest_checkout_private.verified_user_email(_user_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT lower(btrim(u.email)) FROM auth.users u
  WHERE u.id=_user_id AND u.email_confirmed_at IS NOT NULL
    AND COALESCE(u.is_anonymous,false)=false
$$;
REVOKE ALL ON FUNCTION guest_checkout_private.lock_anonymous_user(uuid),
  guest_checkout_private.verified_user_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION guest_checkout_private.lock_anonymous_user(uuid),
  guest_checkout_private.verified_user_email(uuid) TO service_role;

-- These RPCs are server-only SECURITY INVOKER functions. No new client RLS grants.
CREATE FUNCTION public.save_guest_checkout_contact(_user_id uuid, _full_name text, _email text, _phone text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE existing guest_checkout_private.contacts%ROWTYPE; p uuid;
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF NOT guest_checkout_private.lock_anonymous_user(_user_id) THEN RAISE EXCEPTION 'Guest identity required'; END IF;
  SELECT id INTO p FROM public.profiles WHERE user_id=_user_id;
  IF p IS NULL THEN RAISE EXCEPTION 'Guest profile unavailable'; END IF;
  SELECT * INTO existing FROM guest_checkout_private.contacts WHERE guest_user_id=_user_id;
  IF EXISTS (SELECT 1 FROM public.booking_rental_agreements WHERE guest_auth_user_id=_user_id)
     AND (existing.guest_user_id IS NULL OR (existing.full_name,existing.email,existing.phone) IS DISTINCT FROM (btrim(_full_name),lower(btrim(_email)),btrim(_phone))) THEN
    RAISE EXCEPTION 'Contact details are fixed after agreement review. Contact support to correct them.';
  END IF;
  INSERT INTO guest_checkout_private.contacts(guest_user_id,full_name,email,phone)
  VALUES(_user_id,btrim(_full_name),lower(btrim(_email)),btrim(_phone))
  ON CONFLICT(guest_user_id) DO UPDATE SET full_name=EXCLUDED.full_name,email=EXCLUDED.email,phone=EXCLUDED.phone;
  UPDATE public.profiles SET full_name=btrim(_full_name),email=lower(btrim(_email)),phone=btrim(_phone) WHERE id=p;
  -- Never update auth.users.email, email_confirmed_at, or the guest's privileges.
END; $$;

CREATE FUNCTION public.assert_guest_checkout_contact(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM guest_checkout_private.contacts WHERE guest_user_id=_user_id) THEN
    RAISE EXCEPTION 'Complete guest contact details before agreement review';
  END IF;
END; $$;

CREATE FUNCTION public.claim_guest_account_invitations(_sandbox boolean DEFAULT false)
RETURNS TABLE(booking_id uuid,email text,lease_id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  -- Independent polling: a mail/queue failure cannot roll back a paid booking.
  INSERT INTO guest_checkout_private.invitations(booking_id,guest_user_id,email)
  SELECT b.id,c.guest_user_id,c.email FROM public.bookings b
  JOIN public.profiles p ON p.id=b.renter_profile_id
  JOIN guest_checkout_private.contacts c ON c.guest_user_id=p.user_id
  JOIN public.booking_payments pay ON pay.booking_id=b.id AND pay.provider IN ('paypal','square')
  WHERE b.trip_status='confirmed' AND pay.state='paid' AND (pay.environment='live' OR (_sandbox AND pay.environment='sandbox'))
    AND NOT EXISTS(SELECT 1 FROM guest_checkout_private.invitations i WHERE i.booking_id=b.id)
    AND (public.get_provider_rental_payment_receipt(b.id)->>'bookingConfirmed')::boolean IS TRUE
  ORDER BY b.created_at LIMIT 100
  ON CONFLICT DO NOTHING;
  RETURN QUERY
  WITH jobs AS (
    SELECT i.booking_id FROM guest_checkout_private.invitations i
    WHERE i.sent_at IS NULL AND i.attempts<8 AND i.next_attempt_at<=now() AND (i.lease_until IS NULL OR i.lease_until<now())
      AND EXISTS(SELECT 1 FROM public.booking_payments pay WHERE pay.booking_id=i.booking_id AND pay.provider IN ('paypal','square') AND (pay.environment='live' OR (_sandbox AND pay.environment='sandbox')))
      -- confirmed_at records the canonical confirmation already checked when
      -- enqueued. Account mail retries must survive a later trip start/return.
    ORDER BY i.confirmed_at FOR UPDATE SKIP LOCKED LIMIT 10
  )
  UPDATE guest_checkout_private.invitations i SET lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=i.attempts+1
  FROM jobs WHERE i.booking_id=jobs.booking_id RETURNING i.booking_id,i.email,i.lease_id;
END; $$;

CREATE FUNCTION public.finish_guest_account_invitation(_booking_id uuid,_lease_id uuid,_sent boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  UPDATE guest_checkout_private.invitations SET sent_at=CASE WHEN _sent THEN now() ELSE NULL END,
    lease_until=NULL,lease_id=NULL,next_attempt_at=now()+interval '1 minute'*power(2,LEAST(attempts,8))
  WHERE booking_id=_booking_id AND lease_id=_lease_id AND sent_at IS NULL;
END; $$;

CREATE FUNCTION public.get_guest_checkout_account_status(_user_id uuid,_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings b JOIN public.profiles p ON p.id=b.renter_profile_id
    JOIN guest_checkout_private.contacts c ON c.guest_user_id=p.user_id WHERE b.id=_booking_id AND p.user_id=_user_id) THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  result:=public.get_provider_rental_payment_receipt(_booking_id);
  RETURN jsonb_build_object('confirmed',COALESCE((result->>'bookingConfirmed')::boolean,false),
    'invitationSent',EXISTS(SELECT 1 FROM guest_checkout_private.invitations WHERE booking_id=_booking_id AND sent_at IS NOT NULL));
END; $$;

CREATE FUNCTION public.get_verified_guest_account_bookings(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE verified_email text; result jsonb;
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  verified_email:=guest_checkout_private.verified_user_email(_user_id);
  IF verified_email IS NULL THEN RAISE EXCEPTION 'Verified email required'; END IF;
  -- The durable binding is made only after server-verified email ownership.
  -- Original renter, signer and all payment records remain unchanged.
  INSERT INTO guest_checkout_private.account_access(booking_id,customer_user_id)
  SELECT i.booking_id,_user_id FROM guest_checkout_private.invitations i WHERE i.email=verified_email
  ON CONFLICT DO NOTHING;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'reference',b.reservation_number,'startDate',b.start_date,
    'endDate',b.end_date,'tripStatus',b.trip_status,'vehicle',concat(v.year,' ',v.brand,' ',v.name),
    'totalCents',b.grand_total_cents,'currency',b.currency) ORDER BY b.created_at DESC),'[]'::jsonb)
  INTO result FROM guest_checkout_private.account_access a JOIN public.bookings b ON b.id=a.booking_id
  JOIN public.vehicles v ON v.id=b.vehicle_id WHERE a.customer_user_id=_user_id;
  RETURN result;
END; $$;

CREATE FUNCTION public.guest_checkout_handover(_actor_user_id uuid,_booking_id uuid,_approve boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; actor public.profiles%ROWTYPE; required boolean;
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  SELECT * INTO actor FROM public.profiles WHERE user_id=_actor_user_id;
  IF b.id IS NULL OR actor.id IS NULL OR NOT (actor.is_admin OR actor.id=b.host_profile_id) THEN RAISE EXCEPTION 'Host or administrator required'; END IF;
  required:=EXISTS(SELECT 1 FROM public.profiles p JOIN guest_checkout_private.contacts c ON c.guest_user_id=p.user_id WHERE p.id=b.renter_profile_id);
  IF _approve THEN
    IF NOT required OR b.trip_status<>'confirmed' THEN RAISE EXCEPTION 'Confirmed guest reservation required'; END IF;
    IF (public.get_provider_rental_payment_receipt(b.id)->>'bookingConfirmed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Canonical booking confirmation required'; END IF;
    -- Preserve a durable account job if the scheduled worker was unavailable
    -- during confirmation. This operation is still separate from payment.
    INSERT INTO guest_checkout_private.invitations(booking_id,guest_user_id,email)
    SELECT b.id,c.guest_user_id,c.email FROM public.profiles p JOIN guest_checkout_private.contacts c ON c.guest_user_id=p.user_id WHERE p.id=b.renter_profile_id
    ON CONFLICT DO NOTHING;
    INSERT INTO guest_checkout_private.handover_verifications(booking_id,verified_by_user_id,identity_checked,license_checked)
    VALUES(b.id,actor.user_id,true,true) ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('required',required,'verified',EXISTS(SELECT 1 FROM guest_checkout_private.handover_verifications WHERE booking_id=b.id));
END; $$;

-- Physical handover only; no change to existing payment/confirmation guards.
CREATE FUNCTION guest_checkout_private.require_handover_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.trip_status='active' AND OLD.trip_status IS DISTINCT FROM NEW.trip_status
    AND EXISTS(SELECT 1 FROM public.profiles p JOIN guest_checkout_private.contacts c ON c.guest_user_id=p.user_id WHERE p.id=NEW.renter_profile_id)
    AND NOT EXISTS(SELECT 1 FROM guest_checkout_private.handover_verifications WHERE booking_id=NEW.id AND identity_checked AND license_checked) THEN
    RAISE EXCEPTION 'Verify guest identity and driver license before vehicle handover';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION guest_checkout_private.require_handover_verification() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guest_checkout_handover_guard BEFORE UPDATE OF trip_status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION guest_checkout_private.require_handover_verification();

REVOKE ALL ON FUNCTION public.save_guest_checkout_contact(uuid,text,text,text),public.claim_guest_account_invitations(boolean),
  public.assert_guest_checkout_contact(uuid),
  public.guest_checkout_handover(uuid,uuid,boolean),
  public.finish_guest_account_invitation(uuid,uuid,boolean),public.get_guest_checkout_account_status(uuid,uuid),
  public.get_verified_guest_account_bookings(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_guest_checkout_contact(uuid,text,text,text),public.claim_guest_account_invitations(boolean),
  public.assert_guest_checkout_contact(uuid),
  public.guest_checkout_handover(uuid,uuid,boolean),
  public.finish_guest_account_invitation(uuid,uuid,boolean),public.get_guest_checkout_account_status(uuid,uuid),
  public.get_verified_guest_account_bookings(uuid) TO service_role;

-- Reservation confirmation retries are independent of account-link delivery.
CREATE TABLE guest_checkout_private.confirmation_jobs (
 booking_id uuid PRIMARY KEY REFERENCES public.bookings(id), sent_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, lease_id uuid, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE guest_checkout_private.confirmation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guest_checkout_private.confirmation_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON guest_checkout_private.confirmation_jobs TO service_role;
CREATE FUNCTION public.claim_guest_confirmation_emails(_sandbox boolean DEFAULT false)
RETURNS TABLE(booking_id uuid,lease_id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 INSERT INTO guest_checkout_private.confirmation_jobs(booking_id)
 SELECT b.id FROM public.bookings b JOIN public.profiles g ON g.id=b.renter_profile_id
 JOIN guest_checkout_private.contacts c ON c.guest_user_id=g.user_id
 JOIN public.booking_payments p ON p.booking_id=b.id
 WHERE b.trip_status='confirmed' AND p.provider IN('paypal','square') AND p.state='paid'
 AND (p.environment='live' OR (_sandbox AND p.environment='sandbox'))
 AND (public.get_provider_rental_payment_receipt(b.id)->>'bookingConfirmed')::boolean IS TRUE
 ON CONFLICT DO NOTHING;
 RETURN QUERY WITH jobs AS (
 SELECT q.booking_id FROM guest_checkout_private.confirmation_jobs q
 WHERE q.sent_at IS NULL AND q.attempts<8 AND q.next_attempt_at<=now()
 AND (q.lease_until IS NULL OR q.lease_until<now())
 AND EXISTS(SELECT 1 FROM public.booking_payments p WHERE p.booking_id=q.booking_id AND (p.environment='live' OR (_sandbox AND p.environment='sandbox')))
 ORDER BY q.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 5
 ) UPDATE guest_checkout_private.confirmation_jobs q
 SET lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=q.attempts+1
 FROM jobs WHERE q.booking_id=jobs.booking_id RETURNING q.booking_id,q.lease_id;
END; $$;
CREATE FUNCTION public.finish_guest_confirmation_email(_booking_id uuid,_lease_id uuid,_sent boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 UPDATE guest_checkout_private.confirmation_jobs SET sent_at=CASE WHEN _sent THEN now() ELSE NULL END,
 lease_id=NULL,lease_until=NULL,next_attempt_at=now()+interval '1 minute'*power(2,LEAST(attempts,8))
 WHERE booking_id=_booking_id AND lease_id=_lease_id AND sent_at IS NULL;
END; $$;
REVOKE ALL ON FUNCTION public.claim_guest_confirmation_emails(boolean),public.finish_guest_confirmation_email(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_confirmation_emails(boolean),public.finish_guest_confirmation_email(uuid,uuid,boolean) TO service_role;

COMMIT;
