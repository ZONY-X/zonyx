-- Restore the pre-existing agreement reader and amendment behavior.
CREATE OR REPLACE FUNCTION public.get_booking_rental_agreement(_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION public.admin_amend_rental_agreement(_booking_id uuid, _additional_driver_names text[], _end_date date, _dropoff_time time without time zone, _pickup_location text, _dropoff_location text, _fulfillment_method text, _operational_terms text, _effective_at timestamp with time zone, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; prior public.rental_agreement_revisions%ROWTYPE; actor uuid; state jsonb; changes jsonb:='[]'; names jsonb:='[]'; name text; material boolean; doc text; hash text; new_id uuid; proposal_id uuid; next_number integer; start_ts timestamp; end_ts timestamp;
BEGIN
 IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Amendment reason is required.'; END IF;
 IF _effective_at IS NULL THEN RAISE EXCEPTION 'Effective date/time is required.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
 IF b.trip_status IN('cancelled','completed') THEN RAISE EXCEPTION 'Completed or cancelled rentals cannot be operationally amended.'; END IF;
 SELECT * INTO a FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL; IF NOT FOUND THEN RAISE EXCEPTION 'Accepted Rental Agreement not found.'; END IF;
 SELECT r.* INTO prior FROM public.rental_agreement_current_revisions p JOIN public.rental_agreement_revisions r ON r.id=p.revision_id WHERE p.booking_id=b.id FOR UPDATE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current operative Rental Agreement revision not found.'; END IF;
 FOR name IN SELECT DISTINCT btrim(x) FROM unnest(COALESCE(_additional_driver_names,'{}')) x WHERE length(btrim(x))>=2 ORDER BY 1 LOOP names:=names||jsonb_build_array(jsonb_build_object('legal_name',name,'role','additional')); END LOOP;
 state:=prior.operative_state||jsonb_build_object('additional_authorized_drivers',names,'end_date',_end_date,'dropoff_time',_dropoff_time,'pickup_location',btrim(_pickup_location),'dropoff_location',btrim(_dropoff_location),'fulfillment_method',_fulfillment_method,'operational_terms',COALESCE(NULLIF(btrim(_operational_terms),''),'None'));
 IF prior.operative_state->'additional_authorized_drivers' IS DISTINCT FROM names THEN changes:=changes||jsonb_build_array(jsonb_build_object('field','additional_authorized_drivers','from',COALESCE((SELECT string_agg(value->>'legal_name',', ') FROM jsonb_array_elements(prior.operative_state->'additional_authorized_drivers')),'None'),'to',COALESCE((SELECT string_agg(value->>'legal_name',', ') FROM jsonb_array_elements(names)),'None'))); END IF;
 IF prior.operative_state->>'end_date' IS DISTINCT FROM _end_date::text THEN changes:=changes||jsonb_build_array(jsonb_build_object('field','end_date','from',prior.operative_state->>'end_date','to',_end_date)); END IF;
 IF left(prior.operative_state->>'dropoff_time',5) IS DISTINCT FROM left(_dropoff_time::text,5) THEN changes:=changes||jsonb_build_array(jsonb_build_object('field','dropoff_time','from',left(prior.operative_state->>'dropoff_time',5),'to',left(_dropoff_time::text,5))); END IF;
 IF prior.operative_state->>'pickup_location' IS DISTINCT FROM btrim(_pickup_location) THEN changes:=changes||jsonb_build_array(jsonb_build_object('field','pickup_location','from',prior.operative_state->>'pickup_location','to',btrim(_pickup_location))); END IF;
 IF prior.operative_state->>'dropoff_location' IS DISTINCT FROM btrim(_dropoff_location) THEN changes:=changes||jsonb_build_array(jsonb_build_object('field','dropoff_location','from',prior.operative_state->>'dropoff_location','to',btrim(_dropoff_location))); END IF;
 IF prior.operative_state->>'fulfillment_method' IS DISTINCT FROM _fulfillment_method THEN changes:=changes||jsonb_build_array(jsonb_build_object('field','fulfillment_method','from',prior.operative_state->>'fulfillment_method','to',_fulfillment_method)); END IF;
 IF prior.operative_state->>'operational_terms' IS DISTINCT FROM COALESCE(NULLIF(btrim(_operational_terms),''),'None') THEN changes:=changes||jsonb_build_array(jsonb_build_object('field','operational_terms','from',prior.operative_state->>'operational_terms','to',COALESCE(NULLIF(btrim(_operational_terms),''),'None'))); END IF;
 IF jsonb_array_length(changes)=0 THEN RAISE EXCEPTION 'At least one amendable field must change.'; END IF;
 IF _fulfillment_method NOT IN('pickup','delivery','airport_delivery') OR length(btrim(COALESCE(_pickup_location,'')))=0 OR length(btrim(COALESCE(_dropoff_location,'')))=0 THEN RAISE EXCEPTION 'Valid pickup/return logistics are required.'; END IF;
 start_ts:=b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'); end_ts:=_end_date::timestamp+COALESCE(_dropoff_time,time '00:00'); IF end_ts<=start_ts THEN RAISE EXCEPTION 'Return must be after pickup.'; END IF;
 IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id AND x.trip_status IN('confirmed','active','pending_inspection') AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)')&&tsrange(start_ts,end_ts,'[)')) THEN RAISE EXCEPTION 'Amended schedule conflicts with another booking.'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)')&&tsrange(start_ts,end_ts,'[)')) THEN RAISE EXCEPTION 'Amended schedule conflicts with a blocked period.'; END IF;
 material:=(_end_date IS DISTINCT FROM b.end_date OR _dropoff_time IS DISTINCT FROM b.dropoff_time); next_number:=prior.revision_number+1; actor:=public.current_profile_id();
 doc:=public.render_rental_agreement_revision_document(prior.rendered_text,next_number,_effective_at,changes,state,CASE WHEN material THEN 'Pending authenticated customer acceptance' ELSE 'Authorized administrative/operational amendment' END); hash:=encode(extensions.digest(doc,'sha256'),'hex');
 IF material THEN
  INSERT INTO public.rental_agreement_amendment_proposals(agreement_id,booking_id,previous_revision_id,proposed_revision_number,rendered_text,document_hash,proposed_operative_state,field_changes,reason,proposed_effective_at,created_by_profile_id) VALUES(a.id,b.id,prior.id,next_number,doc,hash,state,changes,btrim(_reason),_effective_at,actor) RETURNING id INTO proposal_id;
  INSERT INTO public.rental_agreement_amendment_events(proposal_id,booking_id,event_type,actor_profile_id,evidence) VALUES(proposal_id,b.id,'proposal_created',actor,jsonb_build_object('document_hash',hash,'field_changes',changes));
  RETURN jsonb_build_object('kind','material','proposal_id',proposal_id,'requires_customer_acceptance',true,'document_hash',hash,'revision_number',next_number);
 END IF;
 INSERT INTO public.rental_agreement_revisions(agreement_id,booking_id,revision_number,previous_revision_id,revision_type,rendered_text,document_hash,operative_state,field_changes,reason,effective_at,created_by_profile_id) VALUES(a.id,b.id,next_number,prior.id,'operational_amendment',doc,hash,state,changes,btrim(_reason),_effective_at,actor) RETURNING id INTO new_id;
 UPDATE public.rental_agreement_current_revisions SET revision_id=new_id,set_at=now() WHERE booking_id=b.id;
 UPDATE public.bookings SET pickup_location=btrim(_pickup_location),dropoff_location=btrim(_dropoff_location),fulfillment_method=_fulfillment_method,updated_at=now() WHERE id=b.id;
 INSERT INTO public.rental_agreement_amendment_events(revision_id,booking_id,event_type,actor_profile_id,evidence) VALUES(new_id,b.id,'revision_activated',actor,jsonb_build_object('document_hash',hash,'field_changes',changes,'authority','operational'));
 RETURN jsonb_build_object('kind','operational','revision_id',new_id,'requires_customer_acceptance',false,'document_hash',hash,'revision_number',next_number);
END $function$
;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.payment_rental_addendum_acceptances) THEN
  RAISE EXCEPTION 'Acceptance evidence exists; preserve it instead of removing the empty feature table.';
 END IF;
END $$;
DROP TABLE public.payment_rental_addendum_acceptances;
