-- Read-only agreement retrieval repair. No booking, payment, or contract rows are modified.
CREATE OR REPLACE FUNCTION public.get_booking_rental_agreement(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; v public.rental_agreement_versions%ROWTYPE; r public.rental_agreement_revisions%ROWTYPE; admin_view boolean;
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
 RETURN jsonb_build_object('id',a.id,'booking_id',a.booking_id,'proposed_booking_id',a.proposed_booking_id,'reservation_number',b.reservation_number,'master_agreement_id',a.master_agreement_id,'master_version',a.master_version,'master_title',v.title,'master_content_hash',v.content_hash,'agreement_effective_at',v.effective_at,
  'guest_profile_id',CASE WHEN admin_view THEN a.guest_profile_id ELSE NULL END,'guest_auth_user_id',CASE WHEN admin_view THEN a.guest_auth_user_id ELSE NULL END,'prepared_at',CASE WHEN admin_view THEN a.prepared_at ELSE NULL END,'accepted_at',a.accepted_at,'accepted_ip',CASE WHEN admin_view THEN a.accepted_ip::text ELSE NULL END,'accepted_user_agent',CASE WHEN admin_view THEN a.accepted_user_agent ELSE NULL END,
  'document_hash',COALESCE(r.document_hash,a.document_hash),'rendered_text',COALESCE(r.rendered_text,a.rendered_text),'trip_financial_summary',a.trip_financial_summary,'original_document_hash',a.document_hash,'original_rendered_text',CASE WHEN admin_view THEN a.rendered_text ELSE NULL END,
  'current_revision',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'revision_number',r.revision_number,'revision_type',r.revision_type,'document_hash',r.document_hash,'operative_state',r.operative_state,'field_changes',r.field_changes,'reason',r.reason,'effective_at',r.effective_at,'created_at',r.created_at,'created_by_profile_id',CASE WHEN admin_view THEN r.created_by_profile_id ELSE NULL END,'requires_customer_acceptance',r.requires_customer_acceptance,'customer_accepted_at',r.customer_accepted_at) END,
  'electronic_acceptance_recorded',true,'signature_method','authenticated_electronic_acceptance','audit_metadata_visible',admin_view);
END $$;
REVOKE ALL ON FUNCTION public.get_booking_rental_agreement(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_booking_rental_agreement(uuid) TO authenticated;