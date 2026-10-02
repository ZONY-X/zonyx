-- Admin rental extensions and renewal scheduling. No backfill, communication, or Stripe action.
CREATE TABLE public.rental_extension_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  source_revision_id uuid NOT NULL REFERENCES public.rental_agreement_revisions(id) ON DELETE RESTRICT,
  activated_revision_id uuid REFERENCES public.rental_agreement_revisions(id) ON DELETE RESTRICT,
  original_end_date date NOT NULL,
  original_dropoff_time time NOT NULL,
  extended_through_date date NOT NULL,
  extended_dropoff_time time NOT NULL,
  monthly_amount_cents integer NOT NULL CHECK(monthly_amount_cents>0),
  currency text NOT NULL DEFAULT 'usd' CHECK(currency~'^[a-z]{3}$'),
  anniversary_day integer NOT NULL CHECK(anniversary_day BETWEEN 1 AND 31),
  reminder_lead_days integer NOT NULL DEFAULT 7 CHECK(reminder_lead_days=7),
  communication_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','active','completed','cancelled')),
  reason text NOT NULL CHECK(length(btrim(reason))>=5),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  CHECK(extended_through_date>original_end_date),
  CHECK((status='active' AND activated_at IS NOT NULL AND activated_revision_id IS NOT NULL) OR status<>'active')
);
CREATE UNIQUE INDEX rental_extension_one_scheduled_plan_idx ON public.rental_extension_plans(booking_id) WHERE status='scheduled';

CREATE TABLE public.rental_extension_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_plan_id uuid NOT NULL REFERENCES public.rental_extension_plans(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  period_number integer NOT NULL CHECK(period_number>=1),
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount_due_cents integer NOT NULL CHECK(amount_due_cents>0),
  currency text NOT NULL DEFAULT 'usd' CHECK(currency~'^[a-z]{3}$'),
  billing_reminder_date date NOT NULL,
  payment_status text NOT NULL DEFAULT 'scheduled' CHECK(payment_status IN('scheduled','payment_due','processing','paid','failed')),
  notification_status text NOT NULL DEFAULT 'disabled' CHECK(notification_status IN('disabled','scheduled','reminder_due','sent','failed')),
  communication_enabled boolean NOT NULL DEFAULT false,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  reminder_sent_at timestamptz,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(extension_plan_id,period_number),
  UNIQUE(extension_plan_id,period_start,period_end),
  CHECK(period_end>period_start),
  CHECK(billing_reminder_date=period_start-7)
);
CREATE INDEX rental_extension_periods_booking_idx ON public.rental_extension_periods(booking_id,period_start);

CREATE TABLE public.rental_renewal_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL UNIQUE REFERENCES public.rental_extension_periods(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK(amount_cents>0),
  currency text NOT NULL CHECK(currency~'^[a-z]{3}$'),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','succeeded','failed','reconciliation_required')),
  stripe_payment_intent_id text,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  failure_code text
);

CREATE TABLE public.rental_extension_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  extension_plan_id uuid REFERENCES public.rental_extension_plans(id) ON DELETE RESTRICT,
  period_id uuid REFERENCES public.rental_extension_periods(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN('schedule_created','extension_activated','payment_prepared','payment_succeeded','payment_failed','reminder_sent','reminder_failed')),
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  before_state jsonb NOT NULL DEFAULT '{}',
  after_state jsonb NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  external_reference text
);

ALTER TABLE public.rental_extension_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_extension_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_renewal_payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_extension_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rental_extension_plans,public.rental_extension_periods,public.rental_renewal_payment_attempts,public.rental_extension_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.rental_extension_plans,public.rental_extension_periods,public.rental_renewal_payment_attempts TO service_role;
GRANT SELECT,INSERT ON public.rental_extension_events TO service_role;

CREATE FUNCTION public.prevent_rental_extension_event_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Rental extension audit history is immutable.'; END $$;
CREATE TRIGGER rental_extension_events_immutable BEFORE UPDATE OR DELETE ON public.rental_extension_events FOR EACH ROW EXECUTE FUNCTION public.prevent_rental_extension_event_mutation();

CREATE FUNCTION public.monthly_anniversary_date(_base date,_months integer,_anchor_day integer)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT (date_trunc('month',_base)+make_interval(months=>_months)+make_interval(days=>LEAST(_anchor_day,extract(day from (date_trunc('month',_base)+make_interval(months=>_months)+interval '1 month'-interval '1 day'))::integer)-1))::date
$$;

CREATE FUNCTION public.admin_schedule_rental_extension(_booking_id uuid,_extended_through_date date,_extended_dropoff_time time,_monthly_amount_cents integer,_communication_enabled boolean,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; current_revision uuid; actor uuid; plan_id uuid; anchor integer; n integer:=1; period_start date; period_end date; created integer:=0;
BEGIN
 IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Extension reason is required.'; END IF;
 IF _monthly_amount_cents IS NULL OR _monthly_amount_cents<=0 THEN RAISE EXCEPTION 'A positive amount due per renewal period is required.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
 IF b.trip_status NOT IN('confirmed','active') THEN RAISE EXCEPTION 'Only a confirmed or active rental can be extended.'; END IF;
 IF b.dropoff_time IS NULL OR _extended_dropoff_time IS NULL OR _extended_through_date<=b.end_date THEN RAISE EXCEPTION 'Extended return must be after the current scheduled return.'; END IF;
 IF EXISTS(SELECT 1 FROM public.rental_extension_plans WHERE booking_id=b.id AND status='scheduled') THEN RAISE EXCEPTION 'This booking already has a pending extension schedule.'; END IF;
 SELECT revision_id INTO current_revision FROM public.rental_agreement_current_revisions WHERE booking_id=b.id; IF current_revision IS NULL THEN RAISE EXCEPTION 'Current Operative Agreement not found.'; END IF;
 actor:=public.current_profile_id();anchor:=extract(day from b.end_date)::integer;
 INSERT INTO public.rental_extension_plans(booking_id,source_revision_id,original_end_date,original_dropoff_time,extended_through_date,extended_dropoff_time,monthly_amount_cents,anniversary_day,communication_enabled,reason,created_by_profile_id)
 VALUES(b.id,current_revision,b.end_date,b.dropoff_time,_extended_through_date,_extended_dropoff_time,_monthly_amount_cents,anchor,COALESCE(_communication_enabled,false),btrim(_reason),actor) RETURNING id INTO plan_id;
 period_start:=b.end_date;
 LOOP
  period_end:=public.monthly_anniversary_date(b.end_date,n,anchor);
  IF period_end>_extended_through_date THEN period_end:=_extended_through_date; END IF;
  INSERT INTO public.rental_extension_periods(extension_plan_id,booking_id,period_number,period_start,period_end,amount_due_cents,billing_reminder_date,payment_status,notification_status,communication_enabled,created_by_profile_id)
  VALUES(plan_id,b.id,n,period_start,period_end,_monthly_amount_cents,period_start-7,'scheduled',CASE WHEN COALESCE(_communication_enabled,false) THEN 'scheduled' ELSE 'disabled' END,COALESCE(_communication_enabled,false),actor);
  created:=created+1; EXIT WHEN period_end=_extended_through_date; period_start:=period_end;n:=n+1;
  IF n>120 THEN RAISE EXCEPTION 'Extension schedule exceeds 120 periods.'; END IF;
 END LOOP;
 INSERT INTO public.rental_extension_events(booking_id,extension_plan_id,event_type,actor_profile_id,before_state,after_state,reason)
 VALUES(b.id,plan_id,'schedule_created',actor,jsonb_build_object('end_date',b.end_date,'dropoff_time',b.dropoff_time),jsonb_build_object('extended_through_date',_extended_through_date,'extended_dropoff_time',_extended_dropoff_time,'period_count',created,'communication_enabled',COALESCE(_communication_enabled,false)),btrim(_reason));
 RETURN jsonb_build_object('plan_id',plan_id,'booking_id',b.id,'period_count',created,'status','scheduled','communication_enabled',COALESCE(_communication_enabled,false));
END $$;
REVOKE ALL ON FUNCTION public.admin_schedule_rental_extension(uuid,date,time,integer,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_schedule_rental_extension(uuid,date,time,integer,boolean,text) TO authenticated;

CREATE FUNCTION public.admin_activate_rental_extension(_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.rental_extension_plans%ROWTYPE; b public.bookings%ROWTYPE; prior public.rental_agreement_revisions%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; actor uuid; changes jsonb; state jsonb; doc text; hash text; new_revision uuid; next_number integer; start_ts timestamp; end_ts timestamp;
BEGIN
 IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 SELECT * INTO p FROM public.rental_extension_plans WHERE id=_plan_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Extension schedule not found.'; END IF;
 IF p.status='active' THEN RETURN jsonb_build_object('plan_id',p.id,'revision_id',p.activated_revision_id,'already_active',true); END IF;
 IF p.status<>'scheduled' THEN RAISE EXCEPTION 'Extension schedule is not eligible for activation.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=p.booking_id FOR UPDATE; IF b.trip_status NOT IN('confirmed','active') THEN RAISE EXCEPTION 'Only a confirmed or active rental can be extended.'; END IF;
 IF b.end_date IS DISTINCT FROM p.original_end_date OR b.dropoff_time IS DISTINCT FROM p.original_dropoff_time THEN RAISE EXCEPTION 'Booking schedule changed after the extension was planned. Create a new extension schedule.'; END IF;
 start_ts:=b.start_date::timestamp+COALESCE(b.pickup_time,time '00:00');end_ts:=p.extended_through_date::timestamp+p.extended_dropoff_time;
 IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.vehicle_id=b.vehicle_id AND x.id<>b.id AND x.trip_status IN('confirmed','active','pending_inspection') AND tsrange(x.start_date::timestamp+COALESCE(x.pickup_time,time '00:00'),x.end_date::timestamp+COALESCE(x.dropoff_time,time '00:00'),'[)')&&tsrange(start_ts,end_ts,'[)')) THEN RAISE EXCEPTION 'Extended schedule conflicts with another booking.'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_blocked_periods v WHERE v.vehicle_id=b.vehicle_id AND tsrange(v.start_at::timestamp,v.end_at::timestamp,'[)')&&tsrange(start_ts,end_ts,'[)')) THEN RAISE EXCEPTION 'Extended schedule conflicts with a blocked period.'; END IF;
 SELECT r.* INTO prior FROM public.rental_agreement_current_revisions c JOIN public.rental_agreement_revisions r ON r.id=c.revision_id WHERE c.booking_id=b.id FOR UPDATE OF c;
 SELECT * INTO a FROM public.booking_rental_agreements WHERE booking_id=b.id AND accepted_at IS NOT NULL;
 actor:=public.current_profile_id();next_number:=prior.revision_number+1;
 changes:=jsonb_build_array(jsonb_build_object('field','end_date','from',b.end_date,'to',p.extended_through_date),jsonb_build_object('field','dropoff_time','from',left(b.dropoff_time::text,5),'to',left(p.extended_dropoff_time::text,5)));
 state:=prior.operative_state||jsonb_build_object('end_date',p.extended_through_date,'dropoff_time',p.extended_dropoff_time,'extension_plan_id',p.id);
 doc:=public.render_rental_agreement_revision_document(prior.rendered_text,next_number,now(),changes,state,'Authorized Admin rental extension activation');hash:=encode(extensions.digest(doc,'sha256'),'hex');
 INSERT INTO public.rental_agreement_revisions(agreement_id,booking_id,revision_number,previous_revision_id,revision_type,rendered_text,document_hash,operative_state,field_changes,reason,effective_at,created_by_profile_id)
 VALUES(a.id,b.id,next_number,prior.id,'operational_amendment',doc,hash,state,changes,p.reason,now(),actor) RETURNING id INTO new_revision;
 UPDATE public.rental_agreement_current_revisions SET revision_id=new_revision,set_at=now() WHERE booking_id=b.id;
 UPDATE public.bookings SET end_date=p.extended_through_date,dropoff_time=p.extended_dropoff_time,updated_at=now() WHERE id=b.id;
 UPDATE public.rental_extension_plans SET status='active',activated_revision_id=new_revision,activated_by_profile_id=actor,activated_at=now() WHERE id=p.id;
 INSERT INTO public.rental_extension_events(booking_id,extension_plan_id,event_type,actor_profile_id,before_state,after_state,reason)
 VALUES(b.id,p.id,'extension_activated',actor,jsonb_build_object('end_date',b.end_date,'dropoff_time',b.dropoff_time,'revision_id',prior.id),jsonb_build_object('end_date',p.extended_through_date,'dropoff_time',p.extended_dropoff_time,'revision_id',new_revision),p.reason);
 RETURN jsonb_build_object('plan_id',p.id,'booking_id',b.id,'revision_id',new_revision,'document_hash',hash,'already_active',false);
END $$;
REVOKE ALL ON FUNCTION public.admin_activate_rental_extension(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_activate_rental_extension(uuid) TO authenticated;

CREATE FUNCTION public.get_rental_extension_schedule(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE;
BEGIN
 IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=_booking_id; IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
 RETURN jsonb_build_object('booking_id',b.id,'reservation_number',b.reservation_number,'current_scheduled_return_date',b.end_date,'current_scheduled_return_time',b.dropoff_time,
  'plans',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'original_end_date',p.original_end_date,'original_dropoff_time',p.original_dropoff_time,'extended_through_date',p.extended_through_date,'extended_dropoff_time',p.extended_dropoff_time,'monthly_amount_cents',p.monthly_amount_cents,'currency',p.currency,'communication_enabled',p.communication_enabled,'reason',p.reason,'created_by_profile_id',p.created_by_profile_id,'created_at',p.created_at,'activated_by_profile_id',p.activated_by_profile_id,'activated_at',p.activated_at,'activated_revision_id',p.activated_revision_id) ORDER BY p.created_at) FROM public.rental_extension_plans p WHERE p.booking_id=b.id),'[]'::jsonb),
  'periods',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'extension_plan_id',x.extension_plan_id,'period_number',x.period_number,'period_start',x.period_start,'period_end',x.period_end,'amount_due_cents',x.amount_due_cents,'currency',x.currency,'billing_reminder_date',x.billing_reminder_date,'payment_status',CASE WHEN x.payment_status='scheduled' AND current_date>=x.billing_reminder_date THEN 'payment_due' ELSE x.payment_status END,'notification_status',CASE WHEN x.notification_status='scheduled' AND current_date>=x.billing_reminder_date THEN 'reminder_due' ELSE x.notification_status END,'communication_enabled',x.communication_enabled,'stripe_payment_intent_id',x.stripe_payment_intent_id,'paid_at',x.paid_at,'reminder_sent_at',x.reminder_sent_at,'display_status',CASE WHEN x.payment_status='paid' AND current_date>=x.period_end THEN 'completed' WHEN x.payment_status='paid' AND current_date>=x.period_start THEN 'active' WHEN x.payment_status='paid' THEN 'paid' WHEN current_date>=x.billing_reminder_date AND x.communication_enabled AND x.notification_status<>'sent' THEN 'reminder_due' WHEN current_date>=x.billing_reminder_date THEN 'payment_due' ELSE 'scheduled' END) ORDER BY x.period_start) FROM public.rental_extension_periods x WHERE x.booking_id=b.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_rental_extension_schedule(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rental_extension_schedule(uuid) TO authenticated;

CREATE FUNCTION public.admin_prepare_renewal_payment(_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE x public.rental_extension_periods%ROWTYPE;b public.bookings%ROWTYPE;attempt public.rental_renewal_payment_attempts%ROWTYPE;actor uuid;
BEGIN
 IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Authoritative Admin required.'; END IF;
 SELECT * INTO x FROM public.rental_extension_periods WHERE id=_period_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Renewal period not found.';END IF;
 SELECT * INTO b FROM public.bookings WHERE id=x.booking_id;IF x.payment_status='paid' THEN RETURN jsonb_build_object('already_paid',true,'period_id',x.id,'payment_intent_id',x.stripe_payment_intent_id);END IF;
 IF b.stripe_customer_id IS NULL OR b.stripe_payment_method_id IS NULL THEN RAISE EXCEPTION 'Stored customer payment credentials are unavailable. Use a separately authorized payment collection flow.';END IF;
 actor:=public.current_profile_id();
 INSERT INTO public.rental_renewal_payment_attempts(period_id,booking_id,amount_cents,currency,idempotency_key,created_by_profile_id)
 VALUES(x.id,b.id,x.amount_due_cents,x.currency,'rental-renewal/'||x.id,actor) ON CONFLICT(period_id) DO NOTHING;
 SELECT * INTO attempt FROM public.rental_renewal_payment_attempts WHERE period_id=x.id;
 UPDATE public.rental_extension_periods SET payment_status='processing',updated_at=now() WHERE id=x.id AND payment_status<>'paid';
 INSERT INTO public.rental_extension_events(booking_id,extension_plan_id,period_id,event_type,actor_profile_id,after_state,reason)
 SELECT x.booking_id,x.extension_plan_id,x.id,'payment_prepared',actor,jsonb_build_object('attempt_id',attempt.id,'idempotency_key',attempt.idempotency_key,'amount_cents',attempt.amount_cents),'Explicit Admin renewal payment initiation' WHERE NOT EXISTS(SELECT 1 FROM public.rental_extension_events e WHERE e.period_id=x.id AND e.event_type='payment_prepared');
 RETURN jsonb_build_object('already_paid',false,'attempt_id',attempt.id,'period_id',x.id,'booking_id',b.id,'amount_cents',attempt.amount_cents,'currency',attempt.currency,'idempotency_key',attempt.idempotency_key,'stripe_customer_id',b.stripe_customer_id,'stripe_payment_method_id',b.stripe_payment_method_id,'existing_payment_intent_id',attempt.stripe_payment_intent_id);
END $$;
REVOKE ALL ON FUNCTION public.admin_prepare_renewal_payment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_prepare_renewal_payment(uuid) TO authenticated;

CREATE FUNCTION public.finalize_renewal_payment(_attempt_id uuid,_stripe_payment_intent_id text,_succeeded boolean,_failure_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.rental_renewal_payment_attempts%ROWTYPE;x public.rental_extension_periods%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required.';END IF;
 SELECT * INTO a FROM public.rental_renewal_payment_attempts WHERE id=_attempt_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Renewal payment attempt not found.';END IF;
 SELECT * INTO x FROM public.rental_extension_periods WHERE id=a.period_id FOR UPDATE;
 IF a.status='succeeded' THEN RETURN jsonb_build_object('already_finalized',true,'period_id',x.id,'payment_intent_id',a.stripe_payment_intent_id);END IF;
 IF a.status='failed' AND NOT _succeeded THEN RETURN jsonb_build_object('already_finalized',true,'period_id',x.id,'payment_intent_id',a.stripe_payment_intent_id,'succeeded',false);END IF;
 UPDATE public.rental_renewal_payment_attempts SET status=CASE WHEN _succeeded THEN 'succeeded' ELSE 'failed' END,stripe_payment_intent_id=_stripe_payment_intent_id,finalized_at=now(),failure_code=NULLIF(_failure_code,'') WHERE id=a.id;
 UPDATE public.rental_extension_periods SET payment_status=CASE WHEN _succeeded THEN 'paid' ELSE 'failed' END,stripe_payment_intent_id=_stripe_payment_intent_id,paid_at=CASE WHEN _succeeded THEN now() ELSE NULL END,updated_at=now() WHERE id=x.id;
 INSERT INTO public.rental_extension_events(booking_id,extension_plan_id,period_id,event_type,actor_profile_id,after_state,reason,external_reference)
 VALUES(x.booking_id,x.extension_plan_id,x.id,CASE WHEN _succeeded THEN 'payment_succeeded' ELSE 'payment_failed' END,a.created_by_profile_id,jsonb_build_object('attempt_id',a.id,'amount_cents',a.amount_cents,'succeeded',_succeeded),CASE WHEN _succeeded THEN 'Explicit Admin renewal payment succeeded' ELSE 'Explicit Admin renewal payment failed' END,_stripe_payment_intent_id);
 RETURN jsonb_build_object('already_finalized',false,'period_id',x.id,'payment_intent_id',_stripe_payment_intent_id,'succeeded',_succeeded);
END $$;
REVOKE ALL ON FUNCTION public.finalize_renewal_payment(uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_renewal_payment(uuid,text,boolean,text) TO service_role;

CREATE FUNCTION public.mark_renewal_payment_reconciliation_required(_attempt_id uuid,_failure_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.rental_renewal_payment_attempts%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required.';END IF;
 SELECT * INTO a FROM public.rental_renewal_payment_attempts WHERE id=_attempt_id FOR UPDATE;IF NOT FOUND OR a.status='succeeded' THEN RETURN;END IF;
 UPDATE public.rental_renewal_payment_attempts SET status='reconciliation_required',failure_code=NULLIF(_failure_code,'') WHERE id=a.id;
 UPDATE public.rental_extension_periods SET payment_status='processing',updated_at=now() WHERE id=a.period_id AND payment_status<>'paid';
END $$;
REVOKE ALL ON FUNCTION public.mark_renewal_payment_reconciliation_required(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_renewal_payment_reconciliation_required(uuid,text) TO service_role;

CREATE FUNCTION public.record_renewal_reminder_result(_period_id uuid,_sent boolean,_provider_message_id text,_error_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE x public.rental_extension_periods%ROWTYPE;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required.';END IF;
 SELECT * INTO x FROM public.rental_extension_periods WHERE id=_period_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Renewal period not found.';END IF;
 UPDATE public.rental_extension_periods SET notification_status=CASE WHEN _sent THEN 'sent' ELSE 'failed' END,reminder_sent_at=CASE WHEN _sent THEN now() ELSE NULL END,updated_at=now() WHERE id=x.id;
 INSERT INTO public.rental_extension_events(booking_id,extension_plan_id,period_id,event_type,after_state,reason,external_reference)
 VALUES(x.booking_id,x.extension_plan_id,x.id,CASE WHEN _sent THEN 'reminder_sent' ELSE 'reminder_failed' END,jsonb_build_object('sent',_sent,'error',NULLIF(_error_message,'')),CASE WHEN _sent THEN 'Explicit Admin renewal reminder sent' ELSE 'Explicit Admin renewal reminder failed' END,NULLIF(_provider_message_id,''));
END $$;
REVOKE ALL ON FUNCTION public.record_renewal_reminder_result(uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_renewal_reminder_result(uuid,boolean,text,text) TO service_role;