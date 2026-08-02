-- Clean ZONYX launch baseline.
-- Booking-first architecture with minimal launch tables only:
-- profiles, vehicles, bookings, rental_images.

DROP VIEW IF EXISTS public.hosts_public CASCADE;
DROP VIEW IF EXISTS public.guests_public CASCADE;

DROP TABLE IF EXISTS public.profile_roles CASCADE;
DROP TABLE IF EXISTS public.host_messages CASCADE;
DROP TABLE IF EXISTS public.guest_messages CASCADE;
DROP TABLE IF EXISTS public.vehicle_documents CASCADE;
DROP TABLE IF EXISTS public.vehicle_pricing CASCADE;
DROP TABLE IF EXISTS public.host_locations CASCADE;
DROP TABLE IF EXISTS public.ratings CASCADE;
DROP TABLE IF EXISTS public.reviews CASCADE;
DROP TABLE IF EXISTS public.access_requests CASCADE;
DROP TABLE IF EXISTS public.guests CASCADE;
DROP TABLE IF EXISTS public.hosts CASCADE;
DROP TABLE IF EXISTS public.bookings CASCADE;
DROP TABLE IF EXISTS public.vehicles CASCADE;
DROP TABLE IF EXISTS public.rental_images CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DROP FUNCTION IF EXISTS public.is_host(uuid);
DROP FUNCTION IF EXISTS public.is_guest(uuid);
DROP FUNCTION IF EXISTS public.get_host_id(uuid);
DROP FUNCTION IF EXISTS public.get_guest_id(uuid);
DROP FUNCTION IF EXISTS public.update_updated_at_column();
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.create_booking(uuid, date, date, text, text);
DROP FUNCTION IF EXISTS public.create_booking(uuid, date, date, text, text, time, time, integer);
DROP FUNCTION IF EXISTS public.generate_reservation_number();
DROP FUNCTION IF EXISTS public.assign_booking_context_fields();
DROP FUNCTION IF EXISTS public.current_profile_id();
DROP FUNCTION IF EXISTS public.current_profile_is_admin();
DROP FUNCTION IF EXISTS public.current_profile_is_host();
DROP FUNCTION IF EXISTS public.can_profile_manage_booking(uuid, uuid);
DROP FUNCTION IF EXISTS public.profile_can_update_own_flags();
DROP FUNCTION IF EXISTS public.protect_profile_flags();
DROP FUNCTION IF EXISTS public.attach_checkout_session_to_booking(uuid, text);

DROP SEQUENCE IF EXISTS public.reservation_number_seq;

CREATE SEQUENCE public.reservation_number_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.set_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL,
  phone text,
  avatar_url text,
  is_host boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_identifier text NOT NULL UNIQUE,
  host_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  brand text NOT NULL,
  name text NOT NULL,
  model text NOT NULL,
  year integer NOT NULL CHECK (year >= 1900 AND year <= 2100),
  category text NOT NULL,
  color text NOT NULL,
  seats integer NOT NULL DEFAULT 5 CHECK (seats > 0),
  transmission text NOT NULL DEFAULT 'automatic',
  fuel_type text NOT NULL DEFAULT 'Electric',
  location text NOT NULL DEFAULT 'Miami, FL',
  description text,
  image_url text,
  images text[] NOT NULL DEFAULT ARRAY[]::text[],
  base_daily_rate_cents integer NOT NULL CHECK (base_daily_rate_cents >= 0),
  vin text NOT NULL UNIQUE,
  plate text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (name = model)
);

COMMENT ON COLUMN public.vehicles.is_active IS
'Published/enabled listing switch only. True means visible and eligible. Date availability is derived from overlapping bookings, never this boolean.';

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number text NOT NULL UNIQUE,
  renter_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  host_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  pickup_location text,
  dropoff_location text,
  trip_status text NOT NULL DEFAULT 'pending_payment' CHECK (
    trip_status IN (
      'pending_payment',
      'payment_failed',
      'confirmed',
      'active',
      'pending_inspection',
      'completed',
      'cancelled'
    )
  ),
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  service_fee_cents integer NOT NULL DEFAULT 0 CHECK (service_fee_cents >= 0),
  taxes_cents integer NOT NULL DEFAULT 0 CHECK (taxes_cents >= 0),
  grand_total_cents integer NOT NULL DEFAULT 0 CHECK (grand_total_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_payment_method_id text,
  authorization_hold_payment_intent_id text,
  authorization_hold_amount_cents integer NOT NULL DEFAULT 0 CHECK (authorization_hold_amount_cents >= 0),
  authorization_hold_status text,
  authorization_hold_capture_before bigint,
  authorization_hold_created_at timestamptz,
  odometer_start integer,
  odometer_end integer,
  returned_at timestamptz,
  inspected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  CHECK (authorization_hold_capture_before IS NULL OR authorization_hold_capture_before >= 0),
  CHECK (odometer_start IS NULL OR odometer_start >= 0),
  CHECK (odometer_end IS NULL OR odometer_end >= 0),
  CHECK (odometer_end IS NULL OR odometer_start IS NULL OR odometer_end >= odometer_start)
);

COMMENT ON COLUMN public.bookings.trip_status IS
'pending_inspection means vehicle return happened and host review is in progress before hold release/capture.';

CREATE TABLE public.rental_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  uploaded_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_type text NOT NULL CHECK (image_type IN ('before', 'after')),
  image_url text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_images ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_profile_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT is_admin
      FROM public.profiles
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.current_profile_is_host()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT is_host
      FROM public.profiles
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.generate_reservation_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number bigint;
BEGIN
  next_number := nextval('public.reservation_number_seq');
  RETURN 'ZNX-' || to_char(next_number, 'FM000000');
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.current_profile_is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'Only admins can change admin status.';
  END IF;

  IF NEW.is_host IS DISTINCT FROM OLD.is_host THEN
    RAISE EXCEPTION 'Host status can only be changed through a trusted approval flow.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_profile_manage_booking(_booking_id uuid, _profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = _booking_id
      AND (
        b.renter_profile_id = _profile_id
        OR b.host_profile_id = _profile_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.attach_checkout_session_to_booking(
  _booking_id uuid,
  _stripe_checkout_session_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_id uuid;
  existing_session_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _stripe_checkout_session_id IS NULL OR LENGTH(TRIM(_stripe_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'Stripe checkout session id is required.';
  END IF;

  SELECT id INTO profile_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found for current user.';
  END IF;

  SELECT stripe_checkout_session_id
  INTO existing_session_id
  FROM public.bookings
  WHERE id = _booking_id
    AND renter_profile_id = profile_id
    AND trip_status = 'pending_payment'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found or cannot be updated for checkout.';
  END IF;

  IF existing_session_id IS NOT NULL AND existing_session_id <> _stripe_checkout_session_id THEN
    RAISE EXCEPTION 'Booking already has a different checkout session id.';
  END IF;

  UPDATE public.bookings
  SET stripe_checkout_session_id = _stripe_checkout_session_id,
      updated_at = now()
  WHERE id = _booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_booking_context_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vehicle_row public.vehicles%ROWTYPE;
  renter_profile uuid;
BEGIN
  SELECT * INTO vehicle_row
  FROM public.vehicles
  WHERE id = NEW.vehicle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found.';
  END IF;

  NEW.host_profile_id := vehicle_row.host_profile_id;
  NEW.reservation_number := COALESCE(NEW.reservation_number, public.generate_reservation_number());

  IF NEW.renter_profile_id IS NULL THEN
    SELECT id INTO renter_profile
    FROM public.profiles
    WHERE user_id = auth.uid()
    LIMIT 1;

    IF renter_profile IS NULL THEN
      RAISE EXCEPTION 'A renter profile is required.';
    END IF;

    NEW.renter_profile_id := renter_profile;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_vehicle_name_model()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.name IS NULL OR LENGTH(TRIM(NEW.name)) = 0) AND NEW.model IS NOT NULL THEN
    NEW.name := NEW.model;
  END IF;

  IF (NEW.model IS NULL OR LENGTH(TRIM(NEW.model)) = 0) AND NEW.name IS NOT NULL THEN
    NEW.model := NEW.name;
  END IF;

  IF NEW.name IS DISTINCT FROM NEW.model THEN
    RAISE EXCEPTION 'Vehicle name and model must match in launch schema.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_booking(
  _vehicle_id uuid,
  _start_date date,
  _end_date date,
  _pickup_location text DEFAULT NULL,
  _dropoff_location text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vehicle_row public.vehicles%ROWTYPE;
  renter_profile uuid;
  booking_id uuid;
  rental_days integer;
  subtotal integer;
  service_fee integer;
  taxes integer;
  grand_total integer;
  checkout_hold_timeout interval := interval '20 minutes';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _end_date <= _start_date THEN
    RAISE EXCEPTION 'end_date must be after start_date.';
  END IF;

  SELECT id INTO renter_profile
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF renter_profile IS NULL THEN
    RAISE EXCEPTION 'Profile not found for current user.';
  END IF;

  SELECT * INTO vehicle_row
  FROM public.vehicles
  WHERE id = _vehicle_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or inactive.';
  END IF;

  -- Serialize booking attempts per vehicle to prevent concurrent overlap races.
  PERFORM pg_advisory_xact_lock(hashtext(_vehicle_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.vehicle_id = _vehicle_id
      AND daterange(b.start_date, b.end_date, '[)') && daterange(_start_date, _end_date, '[)')
      AND (
        b.trip_status IN ('confirmed', 'active', 'pending_inspection')
        OR (b.trip_status = 'pending_payment' AND b.created_at >= now() - checkout_hold_timeout)
      )
  ) THEN
    RAISE EXCEPTION 'Vehicle is not available for the selected dates.';
  END IF;

  rental_days := _end_date - _start_date;
  subtotal := vehicle_row.base_daily_rate_cents * rental_days;
  service_fee := ROUND(subtotal * 0.12);
  taxes := ROUND(subtotal * 0.08);
  grand_total := subtotal + service_fee + taxes;

  INSERT INTO public.bookings (
    renter_profile_id,
    host_profile_id,
    vehicle_id,
    start_date,
    end_date,
    pickup_location,
    dropoff_location,
    trip_status,
    subtotal_cents,
    service_fee_cents,
    taxes_cents,
    grand_total_cents,
    currency,
    authorization_hold_amount_cents
  )
  VALUES (
    renter_profile,
    vehicle_row.host_profile_id,
    _vehicle_id,
    _start_date,
    _end_date,
    _pickup_location,
    _dropoff_location,
    'pending_payment',
    subtotal,
    service_fee,
    taxes,
    grand_total,
    'usd',
    0
  )
  RETURNING id INTO booking_id;

  RETURN booking_id;
END;
$$;

CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

CREATE TRIGGER set_vehicles_updated_at
BEFORE UPDATE ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

CREATE TRIGGER set_bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

CREATE TRIGGER set_rental_images_updated_at
BEFORE UPDATE ON public.rental_images
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER protect_profile_flags_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_flags();

CREATE TRIGGER derive_booking_context
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.assign_booking_context_fields();

CREATE TRIGGER sync_vehicle_name_model_trigger
BEFORE INSERT OR UPDATE ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_name_model();

CREATE UNIQUE INDEX bookings_reservation_number_unique ON public.bookings (reservation_number);
CREATE UNIQUE INDEX vehicles_vehicle_identifier_unique ON public.vehicles (vehicle_identifier);
CREATE UNIQUE INDEX vehicles_vin_unique ON public.vehicles (vin);
CREATE UNIQUE INDEX vehicles_plate_unique ON public.vehicles (plate);

CREATE UNIQUE INDEX bookings_stripe_checkout_session_id_unique
  ON public.bookings (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX bookings_authorization_hold_payment_intent_id_unique
  ON public.bookings (authorization_hold_payment_intent_id)
  WHERE authorization_hold_payment_intent_id IS NOT NULL;

CREATE INDEX vehicles_host_profile_id_idx ON public.vehicles (host_profile_id);
CREATE INDEX vehicles_is_active_idx ON public.vehicles (is_active);
CREATE INDEX bookings_vehicle_id_idx ON public.bookings (vehicle_id);
CREATE INDEX bookings_renter_profile_id_idx ON public.bookings (renter_profile_id);
CREATE INDEX bookings_host_profile_id_idx ON public.bookings (host_profile_id);
CREATE INDEX bookings_trip_status_idx ON public.bookings (trip_status);
CREATE INDEX bookings_date_window_idx ON public.bookings (vehicle_id, start_date, end_date);
CREATE INDEX rental_images_booking_id_idx ON public.rental_images (booking_id);
CREATE INDEX rental_images_uploaded_by_profile_id_idx ON public.rental_images (uploaded_by_profile_id);

CREATE POLICY "Profiles select own or admin"
ON public.profiles
FOR SELECT
USING (user_id = auth.uid() OR public.current_profile_is_admin());

CREATE POLICY "Profiles update own basic fields"
ON public.profiles
FOR UPDATE
USING (user_id = auth.uid() OR public.current_profile_is_admin())
WITH CHECK (user_id = auth.uid() OR public.current_profile_is_admin());

CREATE POLICY "Vehicles public read active"
ON public.vehicles
FOR SELECT
USING (is_active = true OR public.current_profile_is_admin() OR host_profile_id = public.current_profile_id());

CREATE POLICY "Vehicles insert own host profile"
ON public.vehicles
FOR INSERT
WITH CHECK (
  public.current_profile_is_admin()
  OR (
    host_profile_id = public.current_profile_id()
    AND public.current_profile_is_host()
  )
);

CREATE POLICY "Vehicles update own host profile"
ON public.vehicles
FOR UPDATE
USING (
  public.current_profile_is_admin()
  OR host_profile_id = public.current_profile_id()
)
WITH CHECK (
  public.current_profile_is_admin()
  OR (
    host_profile_id = public.current_profile_id()
    AND public.current_profile_is_host()
  )
);

CREATE POLICY "Vehicles delete own host profile"
ON public.vehicles
FOR DELETE
USING (
  public.current_profile_is_admin()
  OR host_profile_id = public.current_profile_id()
);

CREATE POLICY "Bookings read renter host admin"
ON public.bookings
FOR SELECT
USING (
  public.current_profile_is_admin()
  OR renter_profile_id = public.current_profile_id()
  OR host_profile_id = public.current_profile_id()
);

-- No direct browser inserts/updates/deletes on bookings.
CREATE POLICY "Bookings direct insert denied"
ON public.bookings
FOR INSERT
WITH CHECK (false);

CREATE POLICY "Bookings direct update denied"
ON public.bookings
FOR UPDATE
USING (false)
WITH CHECK (false);

CREATE POLICY "Bookings direct delete denied"
ON public.bookings
FOR DELETE
USING (false);

CREATE POLICY "Rental images read"
ON public.rental_images
FOR SELECT
USING (
  public.current_profile_is_admin()
  OR uploaded_by_profile_id = public.current_profile_id()
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = public.rental_images.booking_id
      AND b.host_profile_id = public.current_profile_id()
  )
  OR EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = public.rental_images.booking_id
      AND b.renter_profile_id = public.current_profile_id()
  )
);

CREATE POLICY "Rental images insert own"
ON public.rental_images
FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND uploaded_by_profile_id = public.current_profile_id()
  AND (
    public.current_profile_is_admin()
    OR public.can_profile_manage_booking(booking_id, public.current_profile_id())
  )
);

CREATE POLICY "Rental images update own"
ON public.rental_images
FOR UPDATE
USING (
  public.current_profile_is_admin()
  OR uploaded_by_profile_id = public.current_profile_id()
)
WITH CHECK (
  public.current_profile_is_admin()
  OR uploaded_by_profile_id = public.current_profile_id()
);

CREATE POLICY "Rental images delete own"
ON public.rental_images
FOR DELETE
USING (
  public.current_profile_is_admin()
  OR uploaded_by_profile_id = public.current_profile_id()
);

GRANT EXECUTE ON FUNCTION public.create_booking(uuid, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_checkout_session_to_booking(uuid, text) TO authenticated;
