-- Same-booking Admin schedule amendments. No provider calls or payment/deposit writes.
CREATE TABLE public.admin_reservation_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 change_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('edit','extend')),
 before_state jsonb NOT NULL,
 after_state jsonb NOT NULL,
 quote jsonb NOT NULL,
 adjustment_cents bigint NOT NULL,
 renewal_period_id uuid REFERENCES public.rental_extension_periods(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(btrim(reason))>=5),
 actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 created_at timestamptz NOT NULL DEFAULT now(),
 request_id uuid NOT NULL UNIQUE
);
CREATE INDEX admin_reservation_changes_booking_idx ON public.admin_reservation_changes(booking_id,created_at);
ALTER TABLE public.admin_reservation_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_reservation_changes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.admin_reservation_changes TO authenticated;
CREATE POLICY "Admin reads reservation changes" ON public.admin_reservation_changes FOR SELECT TO authenticated USING(public.current_profile_is_admin());
CREATE TRIGGER admin_reservation_changes_immutable BEFORE UPDATE OR DELETE ON public.admin_reservation_changes FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_mutation();

-- Reuse the existing explicit renewal payment flow for one separately owed amount.
-- The marker distinguishes exact-time reservation changes from legacy monthly plans.
ALTER TABLE public.rental_extension_plans ADD COLUMN reservation_change_id uuid REFERENCES public.admin_reservation_changes(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.rental_extension_periods ADD COLUMN reservation_change_id uuid REFERENCES public.admin_reservation_changes(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.rental_extension_plans DROP CONSTRAINT rental_extension_plans_check;
ALTER TABLE public.rental_extension_plans ADD CONSTRAINT rental_extension_plans_check CHECK(extended_through_date>original_end_date OR reservation_change_id IS NOT NULL);
ALTER TABLE public.rental_extension_periods DROP CONSTRAINT rental_extension_periods_check;
ALTER TABLE public.rental_extension_periods ADD CONSTRAINT rental_extension_periods_check CHECK(period_end>period_start OR (period_end=period_start AND reservation_change_id IS NOT NULL));

CREATE SCHEMA IF NOT EXISTS reservation_admin;
REVOKE ALL ON SCHEMA reservation_admin FROM PUBLIC,anon,authenticated;
-- A guard exception requires an immutable record created in THIS transaction and
-- an exact match of ALL non-schedule columns. Browser table updates cannot use it.
CREATE FUNCTION reservation_admin.approved_schedule_change(_old public.bookings,_new public.bookings)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.current_profile_is_admin()
 AND (to_jsonb(_old)-ARRAY['start_date','pickup_time','end_date','dropoff_time','updated_at'])=(to_jsonb(_new)-ARRAY['start_date','pickup_time','end_date','dropoff_time','updated_at'])
 AND EXISTS(SELECT 1 FROM public.admin_reservation_changes c WHERE c.booking_id=_old.id AND c.transaction_id=txid_current() AND c.actor_profile_id=public.current_profile_id()
  AND c.id::text=current_setting('zonyx.reservation_change',true)
  AND c.before_state=jsonb_build_object('start_date',_old.start_date,'pickup_time',_old.pickup_time,'end_date',_old.end_date,'dropoff_time',_old.dropoff_time)
  AND c.after_state=jsonb_build_object('start_date',_new.start_date,'pickup_time',_new.pickup_time,'end_date',_new.end_date,'dropoff_time',_new.dropoff_time));
$$;
REVOKE ALL ON FUNCTION reservation_admin.approved_schedule_change(public.bookings,public.bookings) FROM PUBLIC,anon,authenticated;
-- Retain each installed guard verbatim after the narrow, audited date-only case.
DO $$ DECLARE name text; definition text; BEGIN
 FOREACH name IN ARRAY ARRAY['guard_shared_vehicle_booking','guard_square_booking','protect_provider_payment_booking'] LOOP
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
  IF definition IS NULL THEN RAISE EXCEPTION 'Required reservation guard missing: %',name; END IF;
  definition:=regexp_replace(definition,E'BEGIN\\n',E'BEGIN\n IF reservation_admin.approved_schedule_change(OLD,NEW) THEN RETURN NEW; END IF;\n');
  EXECUTE definition;
 END LOOP;
END $$;

CREATE FUNCTION public.admin_preview_reservation_change(_booking_id uuid,_start_date date,_pickup_time time,_end_date date,_dropoff_time time,_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; s jsonb; prior jsonb; original_days integer; current_days integer; new_days integer; rate numeric; fee_rate numeric; tax_rate numeric; old_rental bigint; new_rental bigint; delta bigint; adjustments bigint; paid bigint; old_span tsrange; span tsrange; price_source text; baseline bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
 IF NOT FOUND OR b.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Reservation not found.'; END IF;
 IF b.trip_status NOT IN ('confirmed','active') THEN RAISE EXCEPTION 'Only confirmed or active reservations can be edited or extended. Use the existing correction flow for historical trips.'; END IF;
 IF _action NOT IN ('edit','extend') OR _action IS NULL THEN RAISE EXCEPTION 'Invalid reservation action.'; END IF;
 new_days:=public.validate_vehicle_rental_duration(b.vehicle_id,_start_date,_pickup_time,_end_date,_dropoff_time);
 old_span:=tsrange(b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00'),b.end_date::timestamp+COALESCE(b.dropoff_time,time '00:00'),'[)');
 span:=tsrange(_start_date::timestamp+_pickup_time,_end_date::timestamp+_dropoff_time,'[)');
 IF _action='extend' AND (_start_date IS DISTINCT FROM b.start_date OR _pickup_time IS DISTINCT FROM b.pickup_time OR upper(span)<=upper(old_span)) THEN RAISE EXCEPTION 'An extension must keep pickup unchanged and move the return later.'; END IF;
 IF span=old_span THEN RAISE EXCEPTION 'Choose different reservation dates or times.'; END IF;
 IF EXISTS(SELECT 1 FROM public.rental_extension_plans p WHERE p.booking_id=b.id AND p.status='scheduled') THEN RAISE EXCEPTION 'Resolve the existing scheduled extension before changing reservation dates.'; END IF;
 IF EXISTS(SELECT 1 FROM public.rental_agreement_amendment_proposals p WHERE p.booking_id=b.id AND NOT EXISTS(SELECT 1 FROM public.rental_agreement_revisions r WHERE r.source_proposal_id=p.id)) THEN RAISE EXCEPTION 'Resolve the pending agreement amendment before editing this reservation.'; END IF;
 IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)')&&span
  AND (x.trip_status IN ('confirmed','active','pending_inspection','completed') OR (x.trip_status='pending_payment' AND x.created_at>=now()-interval '20 minutes') OR EXISTS(SELECT 1 FROM public.booking_payments p WHERE p.booking_id=x.id)))
 OR EXISTS(SELECT 1 FROM public.vehicle_payment_claims c WHERE c.vehicle_id=b.vehicle_id AND c.booking_id<>b.id AND c.released_at IS NULL AND c.reserved_span&&span)
 THEN RAISE EXCEPTION 'Vehicle is not available: the selected dates overlap another reservation.'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)')&&span) THEN RAISE EXCEPTION 'Vehicle is not available: the selected dates overlap a blocked period.'; END IF;
 -- Never edit a payment still being dispatched or reconciled.
 IF EXISTS(SELECT 1 FROM public.booking_payments p WHERE p.booking_id=b.id AND (p.state<>'paid' OR p.paid_at IS NULL)) THEN RAISE EXCEPTION 'Resolve the existing rental payment before changing dates.'; END IF;
 SELECT trip_financial_summary INTO s FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL ORDER BY accepted_at DESC LIMIT 1;
 SELECT quote INTO prior FROM public.admin_reservation_changes WHERE booking_id=b.id ORDER BY change_number DESC LIMIT 1;
 current_days:=public.calculate_rental_days(b.start_date,COALESCE(b.pickup_time,time '00:00'),b.end_date,COALESCE(b.dropoff_time,time '00:00'));
 original_days:=COALESCE((s->>'rental_days')::integer,current_days);
 IF prior IS NOT NULL THEN
  rate:=(prior->>'daily_rate_cents')::numeric;fee_rate:=(prior->>'service_fee_rate')::numeric;tax_rate:=(prior->>'tax_rate')::numeric;price_source:=prior->>'pricing_source';
 ELSIF s->>'daily_rate_cents' IS NOT NULL AND COALESCE(s->>'internal_test','false')<>'true' AND COALESCE(s->>'live_reduced_amount_test','false')<>'true' THEN
  rate:=(s->>'daily_rate_cents')::numeric;fee_rate:=0.12;tax_rate:=0.08;price_source:='Accepted reservation daily rate; 12% service fee and 8% tax. Original one-time add-ons and promotion remain unchanged.';
 ELSE
  -- Legacy/custom reservations retain their observed effective daily price,
  -- including negotiated amounts, rather than applying today's listing rate.
  rate:=b.subtotal_cents::numeric/original_days;fee_rate:=CASE WHEN b.subtotal_cents>0 THEN b.service_fee_cents::numeric/b.subtotal_cents ELSE 0 END;tax_rate:=CASE WHEN b.subtotal_cents>0 THEN b.taxes_cents::numeric/b.subtotal_cents ELSE 0 END;price_source:='Original reservation effective daily rate and fee/tax proportions; no current listing repricing.';
 END IF;
 IF rate IS NULL OR rate<=0 THEN RAISE EXCEPTION 'Original reservation pricing requires review before dates can change.'; END IF;
 old_rental:=round(rate*current_days)+round(round(rate*current_days)*fee_rate)+round(round(rate*current_days)*tax_rate);
 new_rental:=round(rate*new_days)+round(round(rate*new_days)*fee_rate)+round(round(rate*new_days)*tax_rate);
 delta:=new_rental-old_rental;
 SELECT COALESCE(sum(adjustment_cents),0) INTO adjustments FROM public.admin_reservation_changes WHERE booking_id=b.id;
 SELECT COALESCE(sum(p.amount_due_cents),0) INTO paid FROM public.admin_reservation_changes c JOIN public.rental_extension_periods p ON p.id=c.renewal_period_id WHERE c.booking_id=b.id AND p.payment_status='paid' AND p.paid_at IS NOT NULL;
 SELECT COALESCE((SELECT (c.quote->>'original_total_cents')::bigint FROM public.admin_reservation_changes c WHERE c.booking_id=b.id ORDER BY c.change_number LIMIT 1),COALESCE((public.get_booking_financial_summary(b.id)->>'base_trip_total_cents')::bigint,b.grand_total_cents)) INTO baseline;
 delta:=GREATEST(delta,50-baseline-adjustments);
 RETURN jsonb_build_object('booking_id',b.id,'action',_action,'before',jsonb_build_object('start_date',b.start_date,'pickup_time',b.pickup_time,'end_date',b.end_date,'dropoff_time',b.dropoff_time),'after',jsonb_build_object('start_date',_start_date,'pickup_time',_pickup_time,'end_date',_end_date,'dropoff_time',_dropoff_time),
  'current_rental_days',current_days,'new_rental_days',new_days,'additional_rental_days',new_days-current_days,'extension_hours',CASE WHEN _action='extend' THEN extract(epoch from (upper(span)-upper(old_span)))/3600 ELSE 0 END,
  'daily_rate_cents',rate,'service_fee_rate',fee_rate,'tax_rate',tax_rate,'pricing_source',price_source,'adjustment_cents',delta,'additional_charges_cents',GREATEST(0,delta),'credit_cents',GREATEST(0,-delta),'original_total_cents',baseline,'current_total_cents',baseline+adjustments,'updated_total_cents',baseline+adjustments+delta,'outstanding_adjustments_cents',GREATEST(0,adjustments+delta-paid),'currency',b.currency,
  'version',encode(extensions.digest(to_jsonb(b)::text||COALESCE(prior::text,''),'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.admin_preview_reservation_change(uuid,date,time,date,time,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_reservation_change(uuid,date,time,date,time,text) TO authenticated;

CREATE FUNCTION public.admin_save_reservation_change(_booking_id uuid,_start_date date,_pickup_time time,_end_date date,_dropoff_time time,_action text,_reason text,_expected_quote jsonb,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; q jsonb; change_id uuid:=gen_random_uuid(); actor uuid; existing public.admin_reservation_changes%ROWTYPE; prior public.rental_agreement_revisions%ROWTYPE; new_revision_id uuid; changes jsonb; state jsonb; doc text; agreement public.booking_rental_agreements%ROWTYPE; plan_id uuid; period_id uuid; period_start date; period_end date;
BEGIN
 IF auth.uid() IS NULL OR NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 IF length(btrim(COALESCE(_reason,'')))<5 OR _request_id IS NULL THEN RAISE EXCEPTION 'Provide a reason of at least five characters.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.'; END IF;
 SELECT * INTO existing FROM public.admin_reservation_changes WHERE request_id=_request_id;
 IF FOUND THEN
  IF existing.booking_id<>_booking_id OR existing.action<>_action OR existing.after_state<>jsonb_build_object('start_date',_start_date,'pickup_time',_pickup_time,'end_date',_end_date,'dropoff_time',_dropoff_time) THEN RAISE EXCEPTION 'Save request conflicts with an existing change.'; END IF;
  RETURN jsonb_build_object('change_id',existing.id,'booking_id',existing.booking_id,'already_saved',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.rental_extension_periods p WHERE p.booking_id=b.id AND p.reservation_change_id IS NOT NULL AND p.payment_status='processing') THEN RAISE EXCEPTION 'Resolve the in-progress additional payment before changing dates.'; END IF;
 -- Both historical booking creation and provider claims use these locks.
 PERFORM pg_advisory_xact_lock(hashtext(b.vehicle_id::text));
 PERFORM pg_advisory_xact_lock(hashtextextended(b.vehicle_id::text,0));
 q:=public.admin_preview_reservation_change(_booking_id,_start_date,_pickup_time,_end_date,_dropoff_time,_action);
 IF _expected_quote IS NULL OR q<>_expected_quote THEN RAISE EXCEPTION 'Reservation or pricing changed. Review the updated price before saving.'; END IF;
 actor:=public.current_profile_id();
 SELECT r.* INTO prior FROM public.rental_agreement_current_revisions c JOIN public.rental_agreement_revisions r ON r.id=c.revision_id WHERE c.booking_id=b.id FOR UPDATE OF c;
 IF prior.id IS NULL THEN
  SELECT * INTO agreement FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL ORDER BY accepted_at DESC LIMIT 1;
  IF agreement.id IS NOT NULL THEN
   INSERT INTO public.rental_agreement_revisions(agreement_id,booking_id,revision_number,revision_type,rendered_text,document_hash,operative_state,field_changes,reason,effective_at,requires_customer_acceptance,customer_accepted_at,customer_auth_user_id,customer_accepted_ip,customer_accepted_user_agent)
   VALUES(agreement.id,b.id,1,'original_executed',agreement.rendered_text,agreement.document_hash,public.rental_agreement_operative_state(b,agreement),'[]','Original customer-executed Rental Agreement.',agreement.accepted_at,false,agreement.accepted_at,agreement.guest_auth_user_id,agreement.accepted_ip,agreement.accepted_user_agent) RETURNING * INTO prior;
   INSERT INTO public.rental_agreement_current_revisions(booking_id,revision_id) VALUES(b.id,prior.id);
  END IF;
 END IF;
 IF prior.id IS NOT NULL THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('field',key,'from',q->'before'->key,'to',value)),'[]'::jsonb) INTO changes FROM jsonb_each(q->'after') WHERE value IS DISTINCT FROM q->'before'->key;
  changes:=changes||jsonb_build_array(jsonb_build_object('field','reservation_total_cents','from',q->'current_total_cents','to',q->'updated_total_cents'));
  state:=prior.operative_state||(q->'after')||jsonb_build_object('reservation_total_cents',q->'updated_total_cents','reservation_change_id',change_id);
  doc:=public.render_rental_agreement_revision_document(prior.rendered_text,prior.revision_number+1,now(),changes,state,'Authorized Admin reservation schedule change; additional rental balance is unpaid until confirmed');
  INSERT INTO public.rental_agreement_revisions(agreement_id,booking_id,revision_number,previous_revision_id,revision_type,rendered_text,document_hash,operative_state,field_changes,reason,effective_at,created_by_profile_id)
  VALUES(prior.agreement_id,b.id,prior.revision_number+1,prior.id,'operational_amendment',doc,encode(extensions.digest(doc,'sha256'),'hex'),state,changes,btrim(_reason),now(),actor) RETURNING id INTO new_revision_id;
  UPDATE public.rental_agreement_current_revisions SET revision_id=new_revision_id,set_at=now() WHERE booking_id=b.id;
  IF (q->>'adjustment_cents')::bigint>0 THEN
   period_start:=CASE WHEN _action='extend' THEN b.end_date ELSE _start_date END;period_end:=_end_date;
   INSERT INTO public.rental_extension_plans(booking_id,source_revision_id,activated_revision_id,original_end_date,original_dropoff_time,extended_through_date,extended_dropoff_time,monthly_amount_cents,currency,anniversary_day,communication_enabled,status,reason,created_by_profile_id,activated_by_profile_id,activated_at,reservation_change_id)
   VALUES(b.id,prior.id,new_revision_id,b.end_date,COALESCE(b.dropoff_time,time '00:00'),_end_date,_dropoff_time,(q->>'adjustment_cents')::integer,b.currency,extract(day from period_start)::integer,false,'active',btrim(_reason),actor,actor,now(),change_id) RETURNING id INTO plan_id;
   INSERT INTO public.rental_extension_periods(extension_plan_id,booking_id,period_number,period_start,period_end,amount_due_cents,currency,billing_reminder_date,payment_status,notification_status,communication_enabled,created_by_profile_id,reservation_change_id)
   VALUES(plan_id,b.id,1,period_start,period_end,(q->>'adjustment_cents')::integer,b.currency,period_start-7,'payment_due','disabled',false,actor,change_id) RETURNING id INTO period_id;
  END IF;
 END IF;
 INSERT INTO public.admin_reservation_changes(id,booking_id,action,before_state,after_state,quote,adjustment_cents,renewal_period_id,reason,actor_profile_id,request_id)
 VALUES(change_id,b.id,_action,q->'before',q->'after',q,(q->>'adjustment_cents')::bigint,period_id,btrim(_reason),actor,_request_id);
 PERFORM set_config('zonyx.reservation_change',change_id::text,true);
 UPDATE public.bookings SET start_date=_start_date,pickup_time=_pickup_time,end_date=_end_date,dropoff_time=_dropoff_time,updated_at=now() WHERE id=b.id;
 PERFORM set_config('zonyx.reservation_change','',true);
 -- Inventory span follows the operative dates; original payment terms stay frozen.
 UPDATE public.vehicle_payment_claims SET reserved_span=tsrange(_start_date::timestamp+_pickup_time,_end_date::timestamp+_dropoff_time,'[)') WHERE booking_id=b.id AND released_at IS NULL;
 INSERT INTO public.booking_audit_events(booking_id,action_type,reason,before_state,after_state,amount_cents,actor_profile_id)
 VALUES(b.id,'reservation_'||_action,btrim(_reason),(q->'before')||jsonb_build_object('total_cents',q->'current_total_cents'),(q->'after')||jsonb_build_object('total_cents',q->'updated_total_cents','adjustment_cents',q->'adjustment_cents','payment_status','unpaid','change_id',change_id),abs((q->>'adjustment_cents')::bigint),actor);
 RETURN jsonb_build_object('booking_id',b.id,'change_id',change_id,'quote',q,'renewal_period_id',period_id,'already_saved',false);
END $$;
REVOKE ALL ON FUNCTION public.admin_save_reservation_change(uuid,date,time,date,time,text,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_save_reservation_change(uuid,date,time,date,time,text,text,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.admin_get_reservation_changes(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; total bigint; adjustments bigint; paid bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.'; END IF;
 SELECT COALESCE(sum(c.adjustment_cents),0),COALESCE(sum(CASE WHEN p.payment_status='paid' AND p.paid_at IS NOT NULL THEN p.amount_due_cents ELSE 0 END),0) INTO adjustments,paid FROM public.admin_reservation_changes c LEFT JOIN public.rental_extension_periods p ON p.id=c.renewal_period_id WHERE c.booking_id=b.id;
 total:=COALESCE((SELECT (c.quote->>'original_total_cents')::bigint FROM public.admin_reservation_changes c WHERE c.booking_id=b.id ORDER BY c.change_number LIMIT 1),COALESCE((public.get_booking_financial_summary(b.id)->>'base_trip_total_cents')::bigint,b.grand_total_cents))+adjustments;
 RETURN jsonb_build_object('booking',jsonb_build_object('id',b.id,'reservation_number',b.reservation_number,'start_date',b.start_date,'pickup_time',b.pickup_time,'end_date',b.end_date,'dropoff_time',b.dropoff_time,'trip_status',b.trip_status,'currency',b.currency),
 'updated_total_cents',total,'adjustments_cents',adjustments,'outstanding_balance_cents',GREATEST(0,adjustments-paid),'credit_balance_cents',GREATEST(0,paid-adjustments),'payment_collection_supported',b.stripe_customer_id IS NOT NULL AND b.stripe_payment_method_id IS NOT NULL,
 'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'action',c.action,'before',c.before_state,'after',c.after_state,'adjustment_cents',c.adjustment_cents,'quote',c.quote,'reason',c.reason,'actor_profile_id',c.actor_profile_id,'admin_name',pr.full_name,'created_at',c.created_at,'renewal_period_id',c.renewal_period_id,'payment_status',COALESCE(p.payment_status,'unpaid'),'paid_at',p.paid_at) ORDER BY c.change_number DESC) FROM public.admin_reservation_changes c JOIN public.profiles pr ON pr.id=c.actor_profile_id LEFT JOIN public.rental_extension_periods p ON p.id=c.renewal_period_id WHERE c.booking_id=b.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.admin_get_reservation_changes(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_reservation_changes(uuid) TO authenticated;
-- New obligations use the existing renewal collection action. A later credit
-- must not permit that action to collect more than the remaining balance.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.admin_prepare_renewal_payment(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'actor:=public.current_profile_id();', $guard$
 IF x.reservation_change_id IS NOT NULL AND x.payment_status<>'paid' AND x.amount_due_cents > (
  SELECT GREATEST(0,COALESCE(sum(c.adjustment_cents),0)-COALESCE(sum(CASE WHEN ep.payment_status='paid' AND ep.paid_at IS NOT NULL THEN ep.amount_due_cents ELSE 0 END),0))
  FROM public.admin_reservation_changes c LEFT JOIN public.rental_extension_periods ep ON ep.id=c.renewal_period_id WHERE c.booking_id=b.id
 ) THEN RAISE EXCEPTION 'A reservation credit reduced this outstanding balance. Reconcile the collection amount before collecting payment.'; END IF;
 actor:=public.current_profile_id();
 $guard$);
 EXECUTE definition;
END $$;
-- Expose the marker so the legacy monthly planner does not offer payment
-- actions for obligations managed by the new reviewed reservation-change UI.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.get_rental_extension_schedule(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'''id'',p.id,','''id'',p.id,''reservation_change_id'',p.reservation_change_id,');
 definition:=replace(definition,'''id'',x.id,','''id'',x.id,''reservation_change_id'',x.reservation_change_id,');
 EXECUTE definition;
END $$;
