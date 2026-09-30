-- Append-only Rental Agreement revisions. Accepted agreement rows remain untouched.
CREATE TABLE public.rental_agreement_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.booking_rental_agreements(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  previous_revision_id uuid REFERENCES public.rental_agreement_revisions(id) ON DELETE RESTRICT,
  source_correction_id uuid REFERENCES public.booking_rental_agreement_corrections(id) ON DELETE RESTRICT,
  source_proposal_id uuid UNIQUE,
  revision_type text NOT NULL CHECK (revision_type IN ('original_executed','administrative_correction','operational_amendment','customer_accepted_amendment')),
  rendered_text text NOT NULL,
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  operative_state jsonb NOT NULL,
  field_changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(field_changes)='array'),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requires_customer_acceptance boolean NOT NULL DEFAULT false,
  customer_accepted_at timestamptz,
  customer_auth_user_id uuid,
  customer_accepted_ip inet,
  customer_accepted_user_agent text,
  UNIQUE (booking_id, revision_number),
  CHECK ((revision_number=1 AND previous_revision_id IS NULL) OR (revision_number>1 AND previous_revision_id IS NOT NULL)),
  CHECK (encode(extensions.digest(rendered_text,'sha256'),'hex')=document_hash),
  CHECK (NOT requires_customer_acceptance OR customer_accepted_at IS NOT NULL)
);

CREATE TABLE public.rental_agreement_current_revisions (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL UNIQUE REFERENCES public.rental_agreement_revisions(id) ON DELETE RESTRICT,
  set_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rental_agreement_amendment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.booking_rental_agreements(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  previous_revision_id uuid NOT NULL REFERENCES public.rental_agreement_revisions(id) ON DELETE RESTRICT,
  proposed_revision_number integer NOT NULL,
  rendered_text text NOT NULL,
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  proposed_operative_state jsonb NOT NULL,
  field_changes jsonb NOT NULL CHECK (jsonb_typeof(field_changes)='array'),
  reason text NOT NULL CHECK(length(btrim(reason))>=5),
  proposed_effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CHECK (encode(extensions.digest(rendered_text,'sha256'),'hex')=document_hash)
);

ALTER TABLE public.rental_agreement_revisions
  ADD CONSTRAINT rental_agreement_revisions_source_proposal_fkey
  FOREIGN KEY (source_proposal_id) REFERENCES public.rental_agreement_amendment_proposals(id) ON DELETE RESTRICT;

CREATE TABLE public.rental_agreement_amendment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid REFERENCES public.rental_agreement_amendment_proposals(id) ON DELETE RESTRICT,
  revision_id uuid REFERENCES public.rental_agreement_revisions(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN('proposal_created','customer_accepted','revision_activated')),
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_auth_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK(proposal_id IS NOT NULL OR revision_id IS NOT NULL)
);

CREATE TABLE public.rental_agreement_amendment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  revision_id uuid REFERENCES public.rental_agreement_revisions(id) ON DELETE RESTRICT,
  proposal_id uuid REFERENCES public.rental_agreement_amendment_proposals(id) ON DELETE RESTRICT,
  recipient_email text NOT NULL,
  notification_type text NOT NULL CHECK(notification_type IN('operative_amendment','acceptance_required','accepted_amendment')),
  provider_message_id text,
  status text NOT NULL CHECK(status IN('sent','failed')),
  subject text NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  error_message text,
  CHECK(revision_id IS NOT NULL OR proposal_id IS NOT NULL)
);

ALTER TABLE public.rental_agreement_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_agreement_current_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_agreement_amendment_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_agreement_amendment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_agreement_amendment_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rental_agreement_revisions,public.rental_agreement_current_revisions,public.rental_agreement_amendment_proposals,public.rental_agreement_amendment_events,public.rental_agreement_amendment_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.rental_agreement_current_revisions TO service_role;
GRANT SELECT,INSERT ON public.rental_agreement_revisions,public.rental_agreement_amendment_proposals,public.rental_agreement_amendment_events,public.rental_agreement_amendment_notifications TO service_role;

CREATE FUNCTION public.prevent_rental_agreement_revision_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Rental Agreement revision and amendment history is immutable.'; END $$;
CREATE TRIGGER rental_agreement_revisions_immutable BEFORE UPDATE OR DELETE ON public.rental_agreement_revisions FOR EACH ROW EXECUTE FUNCTION public.prevent_rental_agreement_revision_mutation();
CREATE TRIGGER rental_agreement_proposals_immutable BEFORE UPDATE OR DELETE ON public.rental_agreement_amendment_proposals FOR EACH ROW EXECUTE FUNCTION public.prevent_rental_agreement_revision_mutation();
CREATE TRIGGER rental_agreement_events_immutable BEFORE UPDATE OR DELETE ON public.rental_agreement_amendment_events FOR EACH ROW EXECUTE FUNCTION public.prevent_rental_agreement_revision_mutation();
CREATE TRIGGER rental_agreement_notifications_immutable BEFORE UPDATE OR DELETE ON public.rental_agreement_amendment_notifications FOR EACH ROW EXECUTE FUNCTION public.prevent_rental_agreement_revision_mutation();

CREATE FUNCTION public.rental_agreement_operative_state(b public.bookings, a public.booking_rental_agreements)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT jsonb_build_object(
  'primary_authorized_driver',COALESCE(a.trip_financial_summary->'primary_authorized_driver',jsonb_build_object('profile_id',a.guest_profile_id,'legal_name',COALESCE(a.trip_financial_summary->>'guest_legal_name',(a.trip_financial_summary->'authorized_drivers'->0->>'legal_name')),'role','primary')),
  'additional_authorized_drivers',COALESCE(a.trip_financial_summary->'additional_authorized_drivers','[]'::jsonb),
  'start_date',b.start_date,'pickup_time',b.pickup_time,'end_date',b.end_date,'dropoff_time',b.dropoff_time,
  'pickup_location',b.pickup_location,'dropoff_location',b.dropoff_location,'fulfillment_method',b.fulfillment_method,
  'operational_terms',COALESCE(a.trip_financial_summary->>'additional_booking_specific_terms','None')
 )
$$;

CREATE FUNCTION public.render_rental_agreement_revision_document(_base text,_revision_number integer,_effective_at timestamptz,_changes jsonb,_state jsonb,_consent text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT _base||E'\n\n⸻\n\nRENTAL AGREEMENT AMENDMENT — REVISION '||_revision_number||E'\n\n'
  ||'Effective At: '||to_char(_effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||E'\n'
  ||'Amendment Authority: '||_consent||E'\n\n'
  ||'CURRENT OPERATIVE RESERVATION TERMS\n\n'
  ||'Primary Authorized Driver: '||COALESCE(_state->'primary_authorized_driver'->>'legal_name','Not stored')||E'\n'
  ||'Additional Authorized Driver(s): '||COALESCE((SELECT string_agg(value->>'legal_name',', ' ORDER BY ordinality) FROM jsonb_array_elements(COALESCE(_state->'additional_authorized_drivers','[]'::jsonb)) WITH ORDINALITY), 'None')||E'\n'
  ||'Pickup: '||COALESCE(_state->>'start_date','')||' / '||COALESCE(left(_state->>'pickup_time',5),'')||' / '||COALESCE(_state->>'pickup_location','')||E'\n'
  ||'Scheduled Return: '||COALESCE(_state->>'end_date','')||' / '||COALESCE(left(_state->>'dropoff_time',5),'')||' / '||COALESCE(_state->>'dropoff_location','')||E'\n'
  ||'Fulfillment Method: '||COALESCE(_state->>'fulfillment_method','Not stored')||E'\n'
  ||'Reservation-Specific Operational Terms: '||COALESCE(NULLIF(_state->>'operational_terms',''),'None')||E'\n\n'
  ||'FIELD-LEVEL CHANGES\n\n'
  ||COALESCE((SELECT string_agg('- '||(value->>'field')||': '||COALESCE(value->>'from','None')||' → '||COALESCE(value->>'to','None'),E'\n' ORDER BY ordinality) FROM jsonb_array_elements(_changes) WITH ORDINALITY),'No field changes recorded.')
  ||E'\n\nExcept as expressly amended above, all terms of the prior Rental Agreement revision remain unchanged and in effect. Previous executed and amended revisions remain preserved as historical evidence.'
$$;

-- Bootstrap every accepted agreement as revision 1 without changing accepted rows.
INSERT INTO public.rental_agreement_revisions(agreement_id,booking_id,revision_number,revision_type,rendered_text,document_hash,operative_state,field_changes,reason,effective_at,requires_customer_acceptance,customer_accepted_at,customer_auth_user_id,customer_accepted_ip,customer_accepted_user_agent)
SELECT a.id,b.id,1,'original_executed',a.rendered_text,a.document_hash,public.rental_agreement_operative_state(b,a),'[]','Original customer-executed Rental Agreement.',a.accepted_at,false,a.accepted_at,a.guest_auth_user_id,a.accepted_ip,a.accepted_user_agent
FROM public.booking_rental_agreements a JOIN public.bookings b ON b.id=a.booking_id
WHERE a.accepted_at IS NOT NULL ON CONFLICT(booking_id,revision_number) DO NOTHING;

INSERT INTO public.rental_agreement_current_revisions(booking_id,revision_id)
SELECT booking_id,id FROM public.rental_agreement_revisions WHERE revision_number=1 ON CONFLICT(booking_id) DO NOTHING;

-- Promote existing immutable administrative corrections to revision 2.
INSERT INTO public.rental_agreement_revisions(agreement_id,booking_id,revision_number,previous_revision_id,source_correction_id,revision_type,rendered_text,document_hash,operative_state,field_changes,reason,effective_at,created_at,created_by_profile_id)
SELECT a.id,c.booking_id,2,r.id,c.id,'administrative_correction',c.corrected_rendered_text,c.corrected_document_hash,
 r.operative_state||jsonb_build_object('additional_authorized_drivers',jsonb_build_array(jsonb_build_object('legal_name','Alejandra Ponce Gutierrez','role','additional'))),
 jsonb_build_array(jsonb_build_object('field','additional_authorized_drivers','from','None','to','Alejandra Ponce Gutierrez')),c.reason,c.corrected_at,c.corrected_at,c.actor_profile_id
FROM public.booking_rental_agreement_corrections c JOIN public.booking_rental_agreements a ON a.id=c.agreement_id JOIN public.rental_agreement_revisions r ON r.booking_id=c.booking_id AND r.revision_number=1
ON CONFLICT(booking_id,revision_number) DO NOTHING;

UPDATE public.rental_agreement_current_revisions p SET revision_id=r.id,set_at=r.effective_at
FROM public.rental_agreement_revisions r WHERE r.booking_id=p.booking_id AND r.revision_number=2;

-- Normalize the already-corrected ZNX-000150 operative copy to explicit Primary/Additional labels.
INSERT INTO public.rental_agreement_revisions(agreement_id,booking_id,revision_number,previous_revision_id,revision_type,rendered_text,document_hash,operative_state,field_changes,reason,effective_at,created_by_profile_id)
SELECT r.agreement_id,r.booking_id,3,r.id,'operational_amendment',
 replace(r.rendered_text,'Authorized Driver(s): Federico Flores Navarro','Primary Authorized Driver: Federico Flores Navarro'),
 encode(extensions.digest(replace(r.rendered_text,'Authorized Driver(s): Federico Flores Navarro','Primary Authorized Driver: Federico Flores Navarro'),'sha256'),'hex'),
 r.operative_state,jsonb_build_array(jsonb_build_object('field','primary_authorized_driver_label','from','Authorized Driver(s): Federico Flores Navarro','to','Primary Authorized Driver: Federico Flores Navarro')),
 'Normalize operative driver labels while preserving the prior accepted and corrected revisions.',now(),r.created_by_profile_id
FROM public.rental_agreement_revisions r JOIN public.bookings b ON b.id=r.booking_id
WHERE b.reservation_number='ZNX-000150' AND r.revision_number=2
  AND position('Authorized Driver(s): Federico Flores Navarro' in r.rendered_text)>0
ON CONFLICT(booking_id,revision_number) DO NOTHING;

UPDATE public.rental_agreement_current_revisions p SET revision_id=r.id,set_at=r.effective_at
FROM public.rental_agreement_revisions r WHERE r.booking_id=p.booking_id AND r.revision_number=3;

CREATE FUNCTION public.admin_amend_rental_agreement(_booking_id uuid,_additional_driver_names text[],_end_date date,_dropoff_time time,_pickup_location text,_dropoff_location text,_fulfillment_method text,_operational_terms text,_effective_at timestamptz,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.admin_amend_rental_agreement(uuid,text[],date,time,text,text,text,text,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_amend_rental_agreement(uuid,text[],date,time,text,text,text,text,timestamptz,text) TO authenticated;

CREATE FUNCTION public.accept_rental_agreement_amendment(_proposal_id uuid,_document_hash text,_accepted_ip inet,_accepted_user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.rental_agreement_amendment_proposals%ROWTYPE; b public.bookings%ROWTYPE; current_id uuid; profile uuid; new_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 profile:=public.current_profile_id(); SELECT * INTO p FROM public.rental_agreement_amendment_proposals WHERE id=_proposal_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Amendment proposal not found.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=p.booking_id FOR UPDATE; IF b.renter_profile_id<>profile THEN RAISE EXCEPTION 'Only the booking Guest may accept this amendment.'; END IF;
 IF EXISTS(SELECT 1 FROM public.rental_agreement_revisions WHERE source_proposal_id=p.id) THEN SELECT id INTO new_id FROM public.rental_agreement_revisions WHERE source_proposal_id=p.id; RETURN jsonb_build_object('revision_id',new_id,'already_accepted',true); END IF;
 SELECT revision_id INTO current_id FROM public.rental_agreement_current_revisions WHERE booking_id=b.id FOR UPDATE; IF current_id<>p.previous_revision_id THEN RAISE EXCEPTION 'This amendment proposal is no longer current.'; END IF;
 IF p.document_hash<>_document_hash THEN RAISE EXCEPTION 'Amendment document changed. Review it again.'; END IF;
 INSERT INTO public.rental_agreement_revisions(agreement_id,booking_id,revision_number,previous_revision_id,source_proposal_id,revision_type,rendered_text,document_hash,operative_state,field_changes,reason,effective_at,created_by_profile_id,requires_customer_acceptance,customer_accepted_at,customer_auth_user_id,customer_accepted_ip,customer_accepted_user_agent)
 VALUES(p.agreement_id,p.booking_id,p.proposed_revision_number,p.previous_revision_id,p.id,'customer_accepted_amendment',p.rendered_text,p.document_hash,p.proposed_operative_state,p.field_changes,p.reason,p.proposed_effective_at,p.created_by_profile_id,true,now(),auth.uid(),_accepted_ip,NULLIF(_accepted_user_agent,'')) RETURNING id INTO new_id;
 UPDATE public.rental_agreement_current_revisions SET revision_id=new_id,set_at=now() WHERE booking_id=b.id;
 UPDATE public.bookings SET end_date=(p.proposed_operative_state->>'end_date')::date,dropoff_time=(p.proposed_operative_state->>'dropoff_time')::time,pickup_location=p.proposed_operative_state->>'pickup_location',dropoff_location=p.proposed_operative_state->>'dropoff_location',fulfillment_method=p.proposed_operative_state->>'fulfillment_method',updated_at=now() WHERE id=b.id;
 INSERT INTO public.rental_agreement_amendment_events(proposal_id,revision_id,booking_id,event_type,actor_profile_id,actor_auth_user_id,ip_address,user_agent,evidence) VALUES(p.id,new_id,b.id,'customer_accepted',profile,auth.uid(),_accepted_ip,NULLIF(_accepted_user_agent,''),jsonb_build_object('document_hash',p.document_hash));
 RETURN jsonb_build_object('revision_id',new_id,'already_accepted',false);
END $$;
REVOKE ALL ON FUNCTION public.accept_rental_agreement_amendment(uuid,text,inet,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_rental_agreement_amendment(uuid,text,inet,text) TO authenticated;

CREATE FUNCTION public.get_rental_agreement_history(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE;
BEGIN
 IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id; IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
 RETURN jsonb_build_object('booking_id',b.id,'reservation_number',b.reservation_number,'current_revision_id',(SELECT revision_id FROM public.rental_agreement_current_revisions WHERE booking_id=b.id),
  'revisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'revision_number',r.revision_number,'revision_type',r.revision_type,'document_hash',r.document_hash,'rendered_text',r.rendered_text,'operative_state',r.operative_state,'field_changes',r.field_changes,'reason',r.reason,'effective_at',r.effective_at,'created_at',r.created_at,'created_by_profile_id',r.created_by_profile_id,'requires_customer_acceptance',r.requires_customer_acceptance,'customer_accepted_at',r.customer_accepted_at,'customer_auth_user_id',r.customer_auth_user_id,'customer_accepted_ip',r.customer_accepted_ip::text,'customer_accepted_user_agent',r.customer_accepted_user_agent,'previous_revision_id',r.previous_revision_id) ORDER BY r.revision_number) FROM public.rental_agreement_revisions r WHERE r.booking_id=b.id),'[]'::jsonb),
  'pending_proposals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'proposed_revision_number',p.proposed_revision_number,'document_hash',p.document_hash,'rendered_text',p.rendered_text,'proposed_operative_state',p.proposed_operative_state,'field_changes',p.field_changes,'reason',p.reason,'proposed_effective_at',p.proposed_effective_at,'created_at',p.created_at,'created_by_profile_id',p.created_by_profile_id) ORDER BY p.created_at) FROM public.rental_agreement_amendment_proposals p JOIN public.rental_agreement_current_revisions c ON c.booking_id=p.booking_id AND c.revision_id=p.previous_revision_id WHERE p.booking_id=b.id AND NOT EXISTS(SELECT 1 FROM public.rental_agreement_revisions r WHERE r.source_proposal_id=p.id)),'[]'::jsonb),
  'notifications',COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.attempted_at) FROM public.rental_agreement_amendment_notifications n WHERE n.booking_id=b.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_rental_agreement_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rental_agreement_history(uuid) TO authenticated;

CREATE FUNCTION public.get_my_pending_rental_agreement_amendment(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; p public.rental_agreement_amendment_proposals%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id; IF NOT FOUND OR b.renter_profile_id<>public.current_profile_id() THEN RETURN NULL; END IF;
 SELECT x.* INTO p FROM public.rental_agreement_amendment_proposals x JOIN public.rental_agreement_current_revisions c ON c.booking_id=x.booking_id AND c.revision_id=x.previous_revision_id WHERE x.booking_id=b.id AND NOT EXISTS(SELECT 1 FROM public.rental_agreement_revisions r WHERE r.source_proposal_id=x.id) ORDER BY x.created_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('id',p.id,'booking_id',p.booking_id,'reservation_number',b.reservation_number,'proposed_revision_number',p.proposed_revision_number,'rendered_text',p.rendered_text,'document_hash',p.document_hash,'field_changes',p.field_changes,'reason',p.reason,'proposed_effective_at',p.proposed_effective_at,'created_at',p.created_at);
END $$;
REVOKE ALL ON FUNCTION public.get_my_pending_rental_agreement_amendment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_rental_agreement_amendment(uuid) TO authenticated;

CREATE FUNCTION public.record_rental_agreement_amendment_notification(_booking_id uuid,_revision_id uuid,_proposal_id uuid,_recipient_email text,_notification_type text,_provider_message_id text,_status text,_subject text,_payload_hash text,_error_message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 INSERT INTO public.rental_agreement_amendment_notifications(booking_id,revision_id,proposal_id,recipient_email,notification_type,provider_message_id,status,subject,payload_hash,error_message) VALUES(_booking_id,_revision_id,_proposal_id,lower(btrim(_recipient_email)),_notification_type,NULLIF(_provider_message_id,''),_status,_subject,_payload_hash,NULLIF(_error_message,'')) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_rental_agreement_amendment_notification(uuid,uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_rental_agreement_amendment_notification(uuid,uuid,uuid,text,text,text,text,text,text,text) TO service_role;

-- Current agreement retrieval uses stored revision bytes; it never reconstructs from a current template.
CREATE OR REPLACE FUNCTION public.get_booking_rental_agreement(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; v public.rental_agreement_versions%ROWTYPE; r public.rental_agreement_revisions%ROWTYPE; admin_view boolean;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id; IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
 admin_view:=public.current_profile_is_admin(); IF NOT(admin_view OR b.renter_profile_id=public.current_profile_id() OR b.host_profile_id=public.current_profile_id()) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO a FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL; IF NOT FOUND THEN RAISE EXCEPTION 'Accepted Rental Agreement not found.'; END IF;
 SELECT * INTO v FROM public.rental_agreement_versions WHERE id=a.master_agreement_id;
 SELECT rr.* INTO r FROM public.rental_agreement_current_revisions p JOIN public.rental_agreement_revisions rr ON rr.id=p.revision_id WHERE p.booking_id=b.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current operative Rental Agreement not found.'; END IF;
 RETURN jsonb_build_object('id',a.id,'booking_id',a.booking_id,'proposed_booking_id',a.proposed_booking_id,'reservation_number',b.reservation_number,'master_agreement_id',a.master_agreement_id,'master_version',a.master_version,'master_title',v.title,'master_content_hash',v.content_hash,'agreement_effective_at',v.effective_at,
  'guest_profile_id',CASE WHEN admin_view THEN a.guest_profile_id ELSE NULL END,'guest_auth_user_id',CASE WHEN admin_view THEN a.guest_auth_user_id ELSE NULL END,'prepared_at',CASE WHEN admin_view THEN a.prepared_at ELSE NULL END,'accepted_at',a.accepted_at,'accepted_ip',CASE WHEN admin_view THEN a.accepted_ip::text ELSE NULL END,'accepted_user_agent',CASE WHEN admin_view THEN a.accepted_user_agent ELSE NULL END,
  'document_hash',r.document_hash,'rendered_text',r.rendered_text,'trip_financial_summary',a.trip_financial_summary,'original_document_hash',a.document_hash,'original_rendered_text',CASE WHEN admin_view THEN a.rendered_text ELSE NULL END,
  'current_revision',jsonb_build_object('id',r.id,'revision_number',r.revision_number,'revision_type',r.revision_type,'document_hash',r.document_hash,'operative_state',r.operative_state,'field_changes',r.field_changes,'reason',r.reason,'effective_at',r.effective_at,'created_at',r.created_at,'created_by_profile_id',CASE WHEN admin_view THEN r.created_by_profile_id ELSE NULL END,'requires_customer_acceptance',r.requires_customer_acceptance,'customer_accepted_at',r.customer_accepted_at),
  'electronic_acceptance_recorded',true,'signature_method','authenticated_electronic_acceptance','audit_metadata_visible',admin_view);
END $$;
REVOKE ALL ON FUNCTION public.get_booking_rental_agreement(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_booking_rental_agreement(uuid) TO authenticated;