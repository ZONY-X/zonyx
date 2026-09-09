-- Post-trip operations read model. Read-only; no Stripe calls or financial writes.

CREATE OR REPLACE FUNCTION public.get_after_trip_operations(_booking_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE actor uuid; bookings_json jsonb; sources_json jsonb;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
  actor:=public.current_profile_id();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'charge_id',c.id,'booking_id',c.booking_id,'reservation_number',b.reservation_number,
    'vehicle',concat_ws(' ',v.brand,v.model),'guest_name',r.full_name,'guest_email',r.email,
    'host_name',h.full_name,'host_email',h.email,'category',c.category,'amount_cents',c.amount_cents,
    'currency',c.currency,'explanation',c.explanation,'charge_status',c.status,'submitted_at',c.submitted_at,
    'settled_amount_cents',COALESCE(s.settled,0),'remaining_amount_cents',GREATEST(0,c.amount_cents-COALESCE(s.settled,0)),
    'settlement_status',CASE WHEN c.status IN('waived','voided') THEN c.status WHEN COALESCE(s.settled,0)=0 THEN 'unpaid' WHEN COALESCE(s.settled,0)<c.amount_cents THEN 'partially_paid' ELSE 'paid' END
  ) ORDER BY c.submitted_at DESC),'[]'::jsonb) INTO bookings_json
  FROM public.after_trip_charges c JOIN public.bookings b ON b.id=c.booking_id JOIN public.vehicles v ON v.id=b.vehicle_id
  JOIN public.profiles r ON r.id=b.renter_profile_id JOIN public.profiles h ON h.id=b.host_profile_id
  LEFT JOIN LATERAL(SELECT sum(x.amount_cents) settled FROM public.after_trip_charge_settlements x WHERE x.charge_id=c.id AND x.status='proven')s ON true
  WHERE _booking_id IS NULL OR c.booking_id=_booking_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ledger_entry_id',l.id,'booking_id',l.booking_id,'source_type',CASE WHEN l.effect='deposit_capture' THEN 'security_deposit' ELSE 'separate_payment' END,
    'description',l.description,'external_reference',l.external_reference,'amount_cents',l.amount_cents,
    'refunded_cents',COALESCE(ref.refunded,0),'allocated_cents',COALESCE(used.allocated,0),
    'available_cents',GREATEST(0,l.amount_cents-COALESCE(ref.refunded,0)-COALESCE(used.allocated,0)),
    'currency',l.currency,'occurred_at',l.occurred_at
  ) ORDER BY l.occurred_at),'[]'::jsonb) INTO sources_json
  FROM public.booking_financial_ledger l
  LEFT JOIN LATERAL(SELECT sum(x.amount_cents) allocated FROM public.after_trip_charge_settlements x WHERE x.source_ledger_entry_id=l.id AND x.status='proven')used ON true
  LEFT JOIN LATERAL(SELECT sum(x.amount_cents) refunded FROM public.booking_financial_ledger x WHERE x.booking_id=l.booking_id AND x.effect IN('refund','deposit_refund') AND x.status='succeeded' AND x.external_reference IS NOT DISTINCT FROM l.external_reference)ref ON true
  WHERE (_booking_id IS NULL OR l.booking_id=_booking_id) AND l.status='succeeded' AND l.external_reference IS NOT NULL
    AND (l.effect='deposit_capture' OR(l.effect='payment' AND l.category='after_trip_payment'));

  RETURN jsonb_build_object('charges',bookings_json,'settlement_sources',sources_json,'observed_at',now(),'read_only',true);
END; $$;
REVOKE ALL ON FUNCTION public.get_after_trip_operations(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_after_trip_operations(uuid) TO authenticated;