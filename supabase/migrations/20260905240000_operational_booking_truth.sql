-- Hotfix 4B.1: canonical operational booking read model and audited historical
-- schedule/location/fulfillment corrections. No financial values are mutated.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS fulfillment_method text;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_fulfillment_method_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_fulfillment_method_check
  CHECK (fulfillment_method IS NULL OR fulfillment_method IN ('pickup', 'delivery', 'airport_delivery'));

CREATE OR REPLACE FUNCTION public.get_booking_operational_read_model()
RETURNS TABLE (
  id uuid, reservation_number text, renter_profile_id uuid, host_profile_id uuid, vehicle_id uuid,
  start_date date, pickup_time time, end_date date, dropoff_time time,
  pickup_location text, dropoff_location text, fulfillment_method text, trip_status text,
  original_booking_total_cents integer, displayed_total_cents bigint, currency text,
  is_financially_reconciled boolean, deposit_authorized_cents bigint, deposit_captured_cents bigint,
  deposit_released_cents bigint, deposit_refunded_cents bigint, deposit_settled boolean,
  subtotal_cents integer, service_fee_cents integer, taxes_cents integer,
  stripe_checkout_session_id text, authorization_hold_payment_intent_id text,
  authorization_hold_amount_cents integer, authorization_hold_status text,
  vehicle_brand text, vehicle_model text, vehicle_image_url text,
  renter_name text, renter_email text, provider_name text, provider_email text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public
AS $$
  SELECT b.id,b.reservation_number,b.renter_profile_id,b.host_profile_id,b.vehicle_id,
    b.start_date,b.pickup_time,b.end_date,b.dropoff_time,b.pickup_location,b.dropoff_location,b.fulfillment_method,b.trip_status,
    b.grand_total_cents,
    CASE WHEN fs.reconciled THEN fs.final_trip_total_cents ELSE b.grand_total_cents::bigint END,
    b.currency,COALESCE(fs.reconciled,false),COALESCE(fs.deposit_authorized_cents,0),COALESCE(fs.deposit_captured_cents,0),
    COALESCE(fs.deposit_released_cents,0),COALESCE(fs.deposit_refunded_cents,0),COALESCE(fs.deposit_settled,false),
    b.subtotal_cents,b.service_fee_cents,b.taxes_cents,b.stripe_checkout_session_id,b.authorization_hold_payment_intent_id,
    b.authorization_hold_amount_cents,b.authorization_hold_status,v.brand,v.model,v.image_url,
    renter.full_name,renter.email,provider.full_name,provider.email
  FROM public.bookings b
  JOIN public.vehicles v ON v.id=b.vehicle_id
  JOIN public.profiles renter ON renter.id=b.renter_profile_id
  JOIN public.profiles provider ON provider.id=b.host_profile_id
  LEFT JOIN LATERAL (
    SELECT true reconciled,
      COALESCE(sum(CASE WHEN l.effect='trip_debit' THEN l.amount_cents WHEN l.effect='trip_credit' THEN -l.amount_cents ELSE 0 END),0) final_trip_total_cents,
      COALESCE(max(l.amount_cents) FILTER(WHERE l.effect='authorization'),0) deposit_authorized_cents,
      COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_capture'),0) deposit_captured_cents,
      COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_release'),0) deposit_released_cents,
      COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_refund' AND l.status='succeeded'),0) deposit_refunded_cents,
      NOT EXISTS(SELECT 1 FROM public.booking_financial_ledger a WHERE a.booking_id=b.id AND a.effect='authorization' AND a.status NOT IN('canceled','succeeded')) deposit_settled
    FROM public.booking_financial_ledger l WHERE l.booking_id=b.id
    HAVING count(*)>0
  ) fs ON true
  WHERE auth.uid() IS NOT NULL AND (
    public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()
  );
$$;
REVOKE ALL ON FUNCTION public.get_booking_operational_read_model() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_operational_read_model() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_correct_historical_trip_details(
  _booking_id uuid, _start_date date, _pickup_time time, _end_date date, _dropoff_time time,
  _pickup_location text, _dropoff_location text, _fulfillment_method text, _reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; actor uuid; old_state jsonb; new_state jsonb; start_ts timestamp; end_ts timestamp;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
  IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Correction reason is required.'; END IF;
  IF length(btrim(COALESCE(_pickup_location,'')))=0 OR length(btrim(COALESCE(_dropoff_location,'')))=0 THEN RAISE EXCEPTION 'Pickup and drop-off locations are required.'; END IF;
  IF _fulfillment_method NOT IN ('pickup','delivery','airport_delivery') THEN RAISE EXCEPTION 'Valid fulfillment method is required.'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  start_ts:=_start_date::timestamp+COALESCE(_pickup_time,time '00:00'); end_ts:=_end_date::timestamp+COALESCE(_dropoff_time,time '00:00');
  IF end_ts<=start_ts THEN RAISE EXCEPTION 'Drop-off must be after pickup.'; END IF;
  IF b.start_date IS NOT DISTINCT FROM _start_date AND b.pickup_time IS NOT DISTINCT FROM _pickup_time AND b.end_date IS NOT DISTINCT FROM _end_date AND b.dropoff_time IS NOT DISTINCT FROM _dropoff_time AND b.pickup_location IS NOT DISTINCT FROM btrim(_pickup_location) AND b.dropoff_location IS NOT DISTINCT FROM btrim(_dropoff_location) AND b.fulfillment_method IS NOT DISTINCT FROM _fulfillment_method THEN RAISE EXCEPTION 'At least one trip detail must change.'; END IF;
  IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id AND x.trip_status IN('confirmed','active','pending_inspection','completed') AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)')&&tsrange(start_ts,end_ts,'[)')) THEN RAISE EXCEPTION 'Corrected schedule conflicts with another booking.'; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)')&&tsrange(start_ts,end_ts,'[)')) THEN RAISE EXCEPTION 'Corrected schedule conflicts with a blocked period.'; END IF;
  old_state:=jsonb_build_object('start_date',b.start_date,'pickup_time',b.pickup_time,'end_date',b.end_date,'dropoff_time',b.dropoff_time,'pickup_location',b.pickup_location,'dropoff_location',b.dropoff_location,'fulfillment_method',b.fulfillment_method,'trip_status',b.trip_status,'grand_total_cents',b.grand_total_cents);
  new_state:=jsonb_build_object('start_date',_start_date,'pickup_time',_pickup_time,'end_date',_end_date,'dropoff_time',_dropoff_time,'pickup_location',btrim(_pickup_location),'dropoff_location',btrim(_dropoff_location),'fulfillment_method',_fulfillment_method,'trip_status',b.trip_status,'grand_total_cents',b.grand_total_cents);
  actor:=public.current_profile_id();
  UPDATE public.bookings SET start_date=_start_date,pickup_time=_pickup_time,end_date=_end_date,dropoff_time=_dropoff_time,pickup_location=btrim(_pickup_location),dropoff_location=btrim(_dropoff_location),fulfillment_method=_fulfillment_method,updated_at=now() WHERE id=b.id;
  INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,actor_profile_id) VALUES(b.id,'historical_trip_details_correction',btrim(_reason),old_state,new_state,actor);
END; $$;
REVOKE ALL ON FUNCTION public.admin_correct_historical_trip_details(uuid,date,time,date,time,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_historical_trip_details(uuid,date,time,date,time,text,text,text,text) TO authenticated;