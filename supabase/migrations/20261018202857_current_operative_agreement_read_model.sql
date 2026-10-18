-- Read-only projection. No agreement, revision, acceptance, booking, or payment rows are modified.
CREATE OR REPLACE FUNCTION public.get_booking_rental_agreement(_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; v public.rental_agreement_versions%ROWTYPE; r public.rental_agreement_revisions%ROWTYPE; admin_view boolean; plan public.rental_extension_plans%ROWTYPE; renewal_consent public.square_renewal_agreement_acceptances%ROWTYPE; schedule jsonb; operative_renewal jsonb;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id; IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
 admin_view:=public.current_profile_is_admin(); IF NOT COALESCE((admin_view OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()),false) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO a FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL; IF NOT FOUND THEN RAISE EXCEPTION 'Accepted Rental Agreement not found.'; END IF;
 SELECT * INTO v FROM public.rental_agreement_versions WHERE id=a.master_agreement_id;
 SELECT rr.* INTO r FROM public.rental_agreement_current_revisions p JOIN public.rental_agreement_revisions rr ON rr.id=p.revision_id WHERE p.booking_id=b.id;
 IF NOT FOUND THEN
  -- Agreements accepted by the checkout may predate revision initialization.
  -- Read their exact accepted bytes; never overwrite or regenerate legal terms.
  IF EXISTS(SELECT 1 FROM public.rental_agreement_revisions WHERE booking_id=b.id) THEN
   RAISE EXCEPTION 'Current operative Rental Agreement not found.';
  END IF;
 END IF;
 -- Read model only: existing auth gate has already authorized this booking.
 SELECT * INTO plan FROM public.rental_extension_plans x
 WHERE x.booking_id=b.id AND x.status IN ('active','completed')
 AND (x.id::text=r.operative_state->>'extension_plan_id' OR x.activated_revision_id=r.id)
 ORDER BY x.activated_at DESC LIMIT 1;
 IF plan.id IS NOT NULL THEN
  SELECT c.* INTO renewal_consent FROM public.square_renewal_agreement_acceptances c
  JOIN public.rental_extension_periods ep ON ep.id=c.period_id AND ep.extension_plan_id=plan.id AND ep.booking_id=b.id
  JOIN public.square_renewal_payment_attempts pa ON pa.period_id=ep.id AND pa.booking_id=b.id AND pa.state='paid' AND pa.environment='live' AND pa.provider_payment_id=ep.square_payment_id AND pa.amount_cents=ep.amount_due_cents AND pa.currency=ep.currency
  JOIN public.square_checkout_authorizations ca ON ca.attempt_id=pa.id AND ca.terms_context->>'rental_agreement_acceptance_id'=c.id::text
  WHERE c.booking_id=b.id AND ep.payment_status='paid' AND c.source_revision_id=r.id AND c.source_revision_hash=r.document_hash AND encode(extensions.digest(c.rendered_text,'sha256'),'hex')=c.document_hash
  ORDER BY c.accepted_at DESC LIMIT 1;
  SELECT jsonb_agg(jsonb_build_object('id',ep.id,'period_number',ep.period_number,'period_start',ep.period_start,'period_end',ep.period_end,'amount_cents',ep.amount_due_cents,'currency',ep.currency,'payment_status',ep.payment_status,'paid_at',CASE WHEN evidence.id IS NOT NULL THEN ep.paid_at ELSE NULL END,'verified_square_payment_id',evidence.provider_payment_id) ORDER BY ep.period_number) INTO schedule
  FROM public.rental_extension_periods ep
  LEFT JOIN LATERAL (SELECT pa.id,pa.provider_payment_id FROM public.square_renewal_payment_attempts pa WHERE pa.period_id=ep.id AND pa.booking_id=b.id AND pa.state='paid' AND pa.environment='live' AND pa.provider_payment_id=ep.square_payment_id AND pa.amount_cents=ep.amount_due_cents AND pa.currency=ep.currency ORDER BY pa.settled_at DESC LIMIT 1) evidence ON ep.payment_status='paid'
  WHERE ep.extension_plan_id=plan.id AND ep.booking_id=b.id;
  operative_renewal:=jsonb_build_object('projection_version',1,'source_revision_id',r.id,'source_revision_hash',r.document_hash,'extension_plan_id',plan.id,
   'extension_start_date',(SELECT min(period_start) FROM public.rental_extension_periods WHERE extension_plan_id=plan.id AND booking_id=b.id),'extension_start_time',NULL,
   'return_date',COALESCE(r.operative_state->>'end_date',plan.extended_through_date::text),'return_time',COALESCE(r.operative_state->>'dropoff_time',plan.extended_dropoff_time::text),
   'original_start_date',a.trip_financial_summary->>'start_date','original_end_date',a.trip_financial_summary->>'end_date','original_amount_cents',a.trip_financial_summary->'final_total_cents','currency',plan.currency,'periods',COALESCE(schedule,'[]'::jsonb),
   'accepted_renewal',CASE WHEN renewal_consent.id IS NULL THEN NULL ELSE jsonb_build_object('id',renewal_consent.id,'period_id',renewal_consent.period_id,'version',renewal_consent.agreement_version,'version_id',renewal_consent.version_id,'accepted_at',renewal_consent.accepted_at,'document_hash',renewal_consent.document_hash,'rendered_text',renewal_consent.rendered_text,'consent_text',renewal_consent.consent_text) END);
 END IF;

 RETURN jsonb_build_object('id',a.id,'booking_id',a.booking_id,'proposed_booking_id',a.proposed_booking_id,'reservation_number',b.reservation_number,'master_agreement_id',a.master_agreement_id,'master_version',a.master_version,'master_title',v.title,'master_content_hash',v.content_hash,'agreement_effective_at',v.effective_at,
  'guest_profile_id',CASE WHEN admin_view THEN a.guest_profile_id ELSE NULL END,'guest_auth_user_id',CASE WHEN admin_view THEN a.guest_auth_user_id ELSE NULL END,'prepared_at',CASE WHEN admin_view THEN a.prepared_at ELSE NULL END,'accepted_at',a.accepted_at,'accepted_ip',CASE WHEN admin_view THEN a.accepted_ip::text ELSE NULL END,'accepted_user_agent',CASE WHEN admin_view THEN a.accepted_user_agent ELSE NULL END,
  'document_hash',COALESCE(r.document_hash,a.document_hash),'rendered_text',COALESCE(r.rendered_text,a.rendered_text),'trip_financial_summary',a.trip_financial_summary,'original_document_hash',a.document_hash,'original_rendered_text',CASE WHEN admin_view THEN a.rendered_text ELSE NULL END,
  'current_revision',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'revision_number',r.revision_number,'revision_type',r.revision_type,'document_hash',r.document_hash,'operative_state',r.operative_state,'field_changes',r.field_changes,'reason',r.reason,'effective_at',r.effective_at,'created_at',r.created_at,'created_by_profile_id',CASE WHEN admin_view THEN r.created_by_profile_id ELSE NULL END,'requires_customer_acceptance',r.requires_customer_acceptance,'customer_accepted_at',r.customer_accepted_at) END,
  'electronic_acceptance_recorded',true,'signature_method','authenticated_electronic_acceptance','audit_metadata_visible',admin_view,'operative_renewal',operative_renewal);
END $function$
;
