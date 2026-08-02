-- Vehicle seed for the ZONYX launch baseline.
-- Host lookup method: profiles.email values listed in host_seed_map.
-- This seed intentionally fails when a required host profile is missing.

DO $$
DECLARE
  host_seed record;
  resolved_host_profile_id uuid;
BEGIN
  FOR host_seed IN
    SELECT *
    FROM (
      VALUES
        (
          'zoeysnp@gmail.com'::text,
          'ZONYX-TESLA-M3-001'::text,
          'Tesla'::text,
          'Model 3'::text,
          2025,
          'Electric Sedan'::text,
          'White'::text,
          5,
          'automatic'::text,
          'Electric'::text,
          'Miami, FL'::text,
          'Launch fleet vehicle configured for booking-first checkout.'::text,
          '/images/model3-fsd.jpg'::text,
          12900,
          '5YJ3E1EA0MF000001'::text,
          'ZNYX-001'::text,
          true
        ),
        (
          'zoeysnp@gmail.com'::text,
          'ZONYX-CT-AWD-001'::text,
          'Tesla'::text,
          'Cybertruck AWD'::text,
          2025,
          'Electric Pickup'::text,
          'Silver'::text,
          5,
          'automatic'::text,
          'Electric'::text,
          'Miami, FL'::text,
          'Launch fleet vehicle aligned with authorization hold configuration.'::text,
          '/images/cybertruck-fsd.png'::text,
          24900,
          '7G2CEHED0SA000001'::text,
          'ZNYX-CT1'::text,
          true
        )
    ) AS host_seed_map(
      host_email,
      vehicle_identifier,
      brand,
      model,
      year,
      category,
      color,
      seats,
      transmission,
      fuel_type,
      location,
      description,
      image_url,
      base_daily_rate_cents,
      vin,
      plate,
      is_active
    )
  LOOP
    SELECT p.id
    INTO resolved_host_profile_id
    FROM public.profiles p
    WHERE p.email = host_seed.host_email
      AND p.is_host = true
    LIMIT 1;

    IF resolved_host_profile_id IS NULL THEN
      RAISE EXCEPTION 'Missing required host profile for seed email: %', host_seed.host_email;
    END IF;

    INSERT INTO public.vehicles (
      vehicle_identifier,
      host_profile_id,
      brand,
      model,
      year,
      category,
      color,
      seats,
      transmission,
      fuel_type,
      location,
      description,
      image_url,
      base_daily_rate_cents,
      vin,
      plate,
      is_active
    )
    VALUES (
      host_seed.vehicle_identifier,
      resolved_host_profile_id,
      host_seed.brand,
      host_seed.model,
      host_seed.year,
      host_seed.category,
      host_seed.color,
      host_seed.seats,
      host_seed.transmission,
      host_seed.fuel_type,
      host_seed.location,
      host_seed.description,
      host_seed.image_url,
      host_seed.base_daily_rate_cents,
      host_seed.vin,
      host_seed.plate,
      host_seed.is_active
    )
    ON CONFLICT (vehicle_identifier) DO NOTHING;
  END LOOP;
END;
$$;