-- Admin removal archives bookings; financial, ledger, audit and provider records are never deleted.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.profiles(id);
CREATE INDEX IF NOT EXISTS bookings_active_idx ON public.bookings (start_date) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.archive_bookings(_booking_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE archived integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Only admins can remove bookings.';
  END IF;
  -- Status-only metadata update: no payment, refund, hold or Square operation is triggered.
  UPDATE public.bookings SET archived_at = now(), archived_by = public.current_profile_id()
  WHERE id = ANY(COALESCE(_booking_ids, ARRAY[]::uuid[])) AND archived_at IS NULL;
  GET DIAGNOSTICS archived = ROW_COUNT;
  RETURN archived;
END; $$;
REVOKE ALL ON FUNCTION public.archive_bookings(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_bookings(uuid[]) TO authenticated;

-- Existing single-delete entry point now archives instead of deleting.
CREATE OR REPLACE FUNCTION public.delete_booking(_booking_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_profile_is_admin() THEN
    RAISE EXCEPTION 'Only admins can remove bookings.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id) THEN
    RAISE EXCEPTION 'Booking not found.';
  END IF;
  PERFORM public.archive_bookings(ARRAY[_booking_id]);
END; $$;
REVOKE ALL ON FUNCTION public.delete_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_booking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_booking_operational_read_model()
RETURNS TABLE(id uuid,reservation_number text,renter_profile_id uuid,host_profile_id uuid,vehicle_id uuid,start_date date,pickup_time time,end_date date,dropoff_time time,pickup_location text,dropoff_location text,fulfillment_method text,trip_status text,original_booking_total_cents integer,displayed_total_cents bigint,currency text,is_financially_reconciled boolean,deposit_authorized_cents bigint,deposit_captured_cents bigint,deposit_released_cents bigint,deposit_refunded_cents bigint,deposit_settled boolean,subtotal_cents integer,service_fee_cents integer,taxes_cents integer,stripe_checkout_session_id text,authorization_hold_payment_intent_id text,authorization_hold_amount_cents integer,authorization_hold_status text,vehicle_brand text,vehicle_model text,vehicle_image_url text,renter_name text,renter_email text,provider_name text,provider_email text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public AS $$
SELECT b.id,b.reservation_number,b.renter_profile_id,b.host_profile_id,b.vehicle_id,b.start_date,b.pickup_time,b.end_date,b.dropoff_time,b.pickup_location,b.dropoff_location,b.fulfillment_method,b.trip_status,b.grand_total_cents,
  CASE WHEN fs.reconciled THEN fs.trip_total ELSE b.grand_total_cents::bigint+COALESCE(fs.after_trip_total,0) END,b.currency,COALESCE(fs.reconciled,false),COALESCE(fs.deposit_authorized,0),COALESCE(fs.deposit_captured,0),COALESCE(fs.deposit_released,0),COALESCE(fs.deposit_refunded,0),COALESCE(fs.deposit_settled,false),b.subtotal_cents,b.service_fee_cents,b.taxes_cents,b.stripe_checkout_session_id,b.authorization_hold_payment_intent_id,b.authorization_hold_amount_cents,b.authorization_hold_status,v.brand,v.model,v.image_url,r.full_name,r.email,p.full_name,p.email
FROM public.bookings b JOIN public.vehicles v ON v.id=b.vehicle_id JOIN public.profiles r ON r.id=b.renter_profile_id JOIN public.profiles p ON p.id=b.host_profile_id
LEFT JOIN LATERAL(SELECT EXISTS(SELECT 1 FROM public.booking_financial_reconciliations z WHERE z.booking_id=b.id) reconciled,COALESCE(sum(CASE WHEN l.effect='trip_debit' THEN l.amount_cents WHEN l.effect='trip_credit' THEN -l.amount_cents ELSE 0 END),0) trip_total,COALESCE(sum(l.amount_cents) FILTER(WHERE l.entry_type='after_trip_charge' AND l.effect='trip_debit'),0)-COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='trip_credit' AND l.category LIKE 'after_trip_%'),0) after_trip_total,COALESCE(max(l.amount_cents) FILTER(WHERE l.effect='authorization'),0) deposit_authorized,COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_capture'),0) deposit_captured,COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_release'),0) deposit_released,COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_refund' AND l.status='succeeded'),0) deposit_refunded,NOT EXISTS(SELECT 1 FROM public.booking_financial_ledger a WHERE a.booking_id=b.id AND a.effect='authorization' AND a.status NOT IN('canceled','succeeded')) deposit_settled FROM public.booking_financial_ledger l WHERE l.booking_id=b.id)fs ON true
WHERE b.archived_at IS NULL AND auth.uid() IS NOT NULL AND(public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()); $$;
REVOKE ALL ON FUNCTION public.get_booking_operational_read_model() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_booking_operational_read_model() TO authenticated;
