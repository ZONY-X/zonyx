-- Phase 2: capability-gated, read-only Operations projections.
-- No existing authorization function, RLS policy, or mutation is changed.

CREATE OR REPLACE FUNCTION public.get_operations_bookings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.current_profile_has_capability('bookings.read_all') OR NOT public.current_profile_has_capability('financial_summary.read_all') THEN
    RAISE EXCEPTION 'Operations booking access required.';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'booking_id',b.id,'reservation_number',b.reservation_number,'trip_status',b.trip_status,
    'start_date',b.start_date,'pickup_time',b.pickup_time,'end_date',b.end_date,'dropoff_time',b.dropoff_time,
    'pickup_location',b.pickup_location,'dropoff_location',b.dropoff_location,'fulfillment_method',b.fulfillment_method,
    'vehicle_id',b.vehicle_id,'vehicle',concat_ws(' ',v.year,v.brand,v.model),'vehicle_image_url',v.image_url,
    'guest_name',r.full_name,'guest_email',r.email,'host_name',h.full_name,'host_email',h.email,
    'currency',b.currency,'financial_reconciled',f.reconciled,'trip_total_cents',CASE WHEN f.reconciled THEN f.trip_total ELSE b.grand_total_cents::bigint+f.after_trip_total END,
    'receipt_available',f.reconciled,
    'paid_cents',f.paid,'refunded_cents',f.refunded,'balance_cents',CASE WHEN f.reconciled THEN f.trip_total ELSE b.grand_total_cents::bigint+f.after_trip_total END-f.paid+f.refunded,
    'deposit_authorized_cents',f.deposit_authorized,'deposit_captured_cents',f.deposit_captured,'deposit_released_cents',f.deposit_released,'deposit_refunded_cents',f.deposit_refunded,'deposit_status',CASE WHEN f.deposit_authorized=0 THEN 'not_recorded' WHEN f.deposit_open THEN 'open' ELSE 'settled' END,
    'after_trip_charge_cents',f.after_trip_total,'after_trip_settled_cents',f.after_trip_settled,'after_trip_outstanding_cents',GREATEST(0,f.after_trip_total-f.after_trip_settled),'after_trip_status',CASE WHEN f.after_trip_total=0 THEN 'none' WHEN f.after_trip_settled=0 THEN 'unpaid' WHEN f.after_trip_settled<f.after_trip_total THEN 'partially_paid' ELSE 'paid' END
  ) ORDER BY b.start_date DESC,b.created_at DESC),'[]'::jsonb) INTO result
  FROM public.bookings b JOIN public.vehicles v ON v.id=b.vehicle_id JOIN public.profiles r ON r.id=b.renter_profile_id JOIN public.profiles h ON h.id=b.host_profile_id
  LEFT JOIN LATERAL(SELECT
    EXISTS(SELECT 1 FROM public.booking_financial_reconciliations x WHERE x.booking_id=b.id) reconciled,
    COALESCE(sum(CASE WHEN l.effect='trip_debit' THEN l.amount_cents WHEN l.effect='trip_credit' THEN -l.amount_cents ELSE 0 END),0) trip_total,
    COALESCE(sum(l.amount_cents) FILTER(WHERE l.entry_type='after_trip_charge' AND l.effect='trip_debit'),0)-COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='trip_credit' AND l.category LIKE 'after_trip_%'),0) after_trip_total,
    COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='payment' AND l.status='succeeded'),0) paid,
    COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='refund' AND l.status='succeeded'),0) refunded,
    COALESCE(max(l.amount_cents) FILTER(WHERE l.effect='authorization'),0) deposit_authorized,
    COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_capture'),0) deposit_captured,
    COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_release'),0) deposit_released,
    COALESCE(sum(l.amount_cents) FILTER(WHERE l.effect='deposit_refund' AND l.status='succeeded'),0) deposit_refunded,
    EXISTS(SELECT 1 FROM public.booking_financial_ledger a WHERE a.booking_id=b.id AND a.effect='authorization' AND a.status NOT IN('canceled','succeeded')) deposit_open,
    COALESCE((SELECT sum(s.amount_cents) FROM public.after_trip_charge_settlements s WHERE s.booking_id=b.id AND s.status='proven'),0) after_trip_settled
    FROM public.booking_financial_ledger l WHERE l.booking_id=b.id)f ON true;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_operations_vehicles()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.current_profile_has_capability('vehicles.read_all') THEN RAISE EXCEPTION 'Operations vehicle access required.'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('vehicle_id',v.id,'vehicle_identifier',v.vehicle_identifier,'year',v.year,'brand',v.brand,'model',v.model,'category',v.category,'color',v.color,'location',v.location,'image_url',v.image_url,'is_active',v.is_active,'availability_status',v.availability_status,'display_order',v.display_order,'host_profile_id',v.host_profile_id,'host_name',p.full_name,'host_email',p.email,'created_at',v.created_at,'updated_at',v.updated_at) ORDER BY v.display_order NULLS LAST,v.created_at DESC),'[]'::jsonb) INTO result FROM public.vehicles v JOIN public.profiles p ON p.id=v.host_profile_id;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_operations_accounts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.current_profile_has_capability('accounts.read_operational') THEN RAISE EXCEPTION 'Operations account access required.'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id',p.id,'full_name',p.full_name,'email',p.email,'is_guest',true,'is_host',p.is_host,'created_at',p.created_at) ORDER BY p.created_at DESC),'[]'::jsonb) INTO result FROM public.profiles p;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_operations_after_trip_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.current_profile_has_capability('after_trip.read_all') THEN RAISE EXCEPTION 'Operations after-trip access required.'; END IF;
  SELECT COALESCE(jsonb_agg(trip ORDER BY trip->>'latest_submitted_at' DESC),'[]'::jsonb) INTO result FROM(
    SELECT jsonb_build_object('booking_id',b.id,'reservation_number',b.reservation_number,'trip_status',b.trip_status,'vehicle',concat_ws(' ',v.year,v.brand,v.model),'guest_name',r.full_name,'guest_email',r.email,'host_name',h.full_name,'host_email',h.email,'currency',b.currency,'latest_submitted_at',max(c.submitted_at),'total_charge_cents',COALESCE(sum(c.amount_cents) FILTER(WHERE c.status NOT IN('waived','voided')),0),'settled_cents',COALESCE(sum(COALESCE(s.settled,0)) FILTER(WHERE c.status NOT IN('waived','voided')),0),'outstanding_cents',COALESCE(sum(GREATEST(0,c.amount_cents-COALESCE(s.settled,0))) FILTER(WHERE c.status NOT IN('waived','voided')),0),'settlement_status',CASE WHEN COALESCE(sum(GREATEST(0,c.amount_cents-COALESCE(s.settled,0))) FILTER(WHERE c.status NOT IN('waived','voided')),0)=0 THEN 'paid' WHEN COALESCE(sum(COALESCE(s.settled,0)) FILTER(WHERE c.status NOT IN('waived','voided')),0)>0 THEN 'partially_paid' ELSE 'unpaid' END,'charges',jsonb_agg(jsonb_build_object('charge_id',c.id,'category',c.category,'amount_cents',c.amount_cents,'explanation',c.explanation,'charge_status',c.status,'submitted_at',c.submitted_at,'settled_amount_cents',COALESCE(s.settled,0),'remaining_amount_cents',GREATEST(0,c.amount_cents-COALESCE(s.settled,0)),'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('image_type',ri.image_type,'notes',ri.notes,'created_at',ri.created_at)) FROM public.after_trip_charge_evidence e JOIN public.rental_images ri ON ri.id=e.rental_image_id WHERE e.charge_id=c.id),'[]'::jsonb)) ORDER BY c.submitted_at)) trip
    FROM public.after_trip_charges c JOIN public.bookings b ON b.id=c.booking_id JOIN public.vehicles v ON v.id=b.vehicle_id JOIN public.profiles r ON r.id=b.renter_profile_id JOIN public.profiles h ON h.id=b.host_profile_id LEFT JOIN LATERAL(SELECT sum(x.amount_cents) settled FROM public.after_trip_charge_settlements x WHERE x.charge_id=c.id AND x.status='proven')s ON true GROUP BY b.id,v.year,v.brand,v.model,r.full_name,r.email,h.full_name,h.email
  )q;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_operations_trip_receipt(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE bookings jsonb; booking jsonb; queue jsonb; charges jsonb; result jsonb;
BEGIN
  IF NOT public.current_profile_has_capability('receipts.read_all') OR NOT public.current_profile_has_capability('financial_summary.read_all') THEN RAISE EXCEPTION 'Operations receipt access required.'; END IF;
  bookings:=public.get_operations_bookings();
  SELECT value INTO booking FROM jsonb_array_elements(bookings) WHERE value->>'booking_id'=_booking_id::text;
  IF booking IS NULL THEN RAISE EXCEPTION 'Booking not found.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.booking_financial_reconciliations r WHERE r.booking_id=_booking_id) THEN RAISE EXCEPTION 'Financial reconciliation is required before a final receipt is available.'; END IF;
  queue:=public.get_operations_after_trip_queue();
  SELECT COALESCE(value->'charges','[]'::jsonb) INTO charges FROM jsonb_array_elements(queue) WHERE value->>'booking_id'=_booking_id::text;
  RETURN jsonb_build_object('booking',booking,'after_trip_charges',COALESCE(charges,'[]'::jsonb),'observed_at',now(),'read_only',true);
END; $$;

REVOKE ALL ON FUNCTION public.get_operations_bookings(),public.get_operations_vehicles(),public.get_operations_accounts(),public.get_operations_after_trip_queue(),public.get_operations_trip_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_operations_bookings(),public.get_operations_vehicles(),public.get_operations_accounts(),public.get_operations_after_trip_queue(),public.get_operations_trip_receipt(uuid) TO authenticated;