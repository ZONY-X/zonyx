-- Square-only renewal collection. Historical financial records remain immutable.
CREATE TABLE public.square_renewal_payment_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES public.rental_extension_periods(id) ON DELETE RESTRICT,
 booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
 generation integer NOT NULL CHECK(generation>0),
 amount_cents bigint NOT NULL CHECK(amount_cents>=50),
 currency text NOT NULL CHECK(currency='usd'),
 environment text NOT NULL CHECK(environment IN('live','sandbox')),
 location_id text NOT NULL CHECK(length(location_id)>0),
 state text NOT NULL DEFAULT 'processing' CHECK(state IN('processing','reconciliation_required','paid','failed','canceled')),
 provider_payment_id text UNIQUE,
 created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 UNIQUE(period_id,generation)
);
CREATE UNIQUE INDEX square_renewal_one_active ON public.square_renewal_payment_attempts(period_id) WHERE state IN('processing','reconciliation_required','paid');
ALTER TABLE public.square_renewal_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_renewal_payment_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.square_renewal_payment_attempts TO service_role;
ALTER TABLE public.rental_extension_periods ADD COLUMN square_payment_id text UNIQUE;

-- Retire every prior renewal collection entrypoint, without erasing its history.
REVOKE ALL ON FUNCTION public.prepare_guest_renewal_checkout(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.attach_guest_renewal_session(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_guest_renewal_evidence(uuid,text,text,bigint,text,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_prepare_renewal_payment(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prepare_square_renewal_payment(_period_id uuid,_user_id uuid,_environment text,_location_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.rental_extension_periods%ROWTYPE; b public.bookings%ROWTYPE; a public.square_renewal_payment_attempts%ROWTYPE; actor uuid; n integer; plan_status text; balance bigint;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 IF _environment NOT IN('live','sandbox') OR COALESCE(_location_id,'')='' THEN RAISE EXCEPTION 'Square configuration required.'; END IF;
 SELECT b0.* INTO b FROM public.bookings b0 JOIN public.rental_extension_periods p0 ON p0.booking_id=b0.id WHERE p0.id=_period_id FOR UPDATE OF b0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Renewal period not found.'; END IF;
 SELECT id INTO actor FROM public.profiles WHERE user_id=_user_id AND id=b.renter_profile_id;
 IF actor IS NULL THEN RAISE EXCEPTION 'Only the reservation guest can submit this payment. Admin inspection never charges a card.'; END IF;
 SELECT * INTO p FROM public.rental_extension_periods WHERE id=_period_id FOR UPDATE;
 IF p.payment_status='paid' THEN RETURN jsonb_build_object('already_paid',true,'period_id',p.id); END IF;
 SELECT status INTO plan_status FROM public.rental_extension_plans WHERE id=p.extension_plan_id;
 IF plan_status<>'active' OR b.archived_at IS NOT NULL OR b.trip_status='cancelled' THEN RAISE EXCEPTION 'This extension is not active or is no longer payable.'; END IF;
 IF p.amount_due_cents<50 OR p.currency<>'usd' THEN RAISE EXCEPTION 'Renewal amount or currency requires review.'; END IF;
 IF EXISTS(SELECT 1 FROM public.renewal_checkout_attempts WHERE period_id=p.id AND state IN('creating','open','processing','paid')) OR EXISTS(SELECT 1 FROM public.rental_renewal_payment_attempts WHERE period_id=p.id AND status IN('prepared','reconciliation_required','succeeded')) THEN RAISE EXCEPTION 'A prior renewal payment requires reconciliation. No new payment was started.'; END IF;
 IF p.reservation_change_id IS NOT NULL THEN
  SELECT GREATEST(0,COALESCE(sum(c.adjustment_cents),0)-COALESCE(sum(CASE WHEN ep.payment_status='paid' AND ep.paid_at IS NOT NULL THEN ep.amount_due_cents ELSE 0 END),0)) INTO balance FROM public.admin_reservation_changes c LEFT JOIN public.rental_extension_periods ep ON ep.id=c.renewal_period_id WHERE c.booking_id=b.id;
  IF balance<p.amount_due_cents THEN RAISE EXCEPTION 'A reservation credit reduced this balance. Contact ZONYX for the corrected payment amount.'; END IF;
 END IF;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE period_id=p.id AND state IN('processing','reconciliation_required','paid') FOR UPDATE;
 IF FOUND THEN
  IF a.amount_cents<>p.amount_due_cents OR a.currency<>p.currency OR a.environment<>_environment OR a.location_id<>_location_id THEN RAISE EXCEPTION 'Existing Square terms require reconciliation.'; END IF;
  RETURN to_jsonb(a)||jsonb_build_object('dispatch',false);
 END IF;
 SELECT COALESCE(max(generation),0)+1 INTO n FROM public.square_renewal_payment_attempts WHERE period_id=p.id;
 INSERT INTO public.square_renewal_payment_attempts(period_id,booking_id,generation,amount_cents,currency,environment,location_id,created_by_profile_id)
 VALUES(p.id,b.id,n,p.amount_due_cents,p.currency,_environment,_location_id,actor) RETURNING * INTO a;
 RETURN to_jsonb(a)||jsonb_build_object('dispatch',true);
END $$;
REVOKE ALL ON FUNCTION public.prepare_square_renewal_payment(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_square_renewal_payment(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.record_square_renewal_payment(_attempt_id uuid,_payment_id text,_amount_cents bigint,_location_id text,_environment text,_status text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.square_renewal_payment_attempts%ROWTYPE; p public.rental_extension_periods%ROWTYPE; next_state text;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT p0.* INTO p FROM public.rental_extension_periods p0 JOIN public.square_renewal_payment_attempts a0 ON a0.period_id=p0.id WHERE a0.id=_attempt_id FOR UPDATE OF p0;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE id=_attempt_id FOR UPDATE;
 IF a.id IS NULL OR a.amount_cents IS DISTINCT FROM _amount_cents OR a.location_id IS DISTINCT FROM _location_id OR a.environment IS DISTINCT FROM _environment OR p.amount_due_cents<>a.amount_cents OR p.currency<>a.currency OR (a.provider_payment_id IS NOT NULL AND a.provider_payment_id IS DISTINCT FROM _payment_id) THEN RAISE EXCEPTION 'Square renewal evidence conflicts.'; END IF;
 IF _status NOT IN('COMPLETED','PENDING','APPROVED','FAILED','CANCELED','UNKNOWN') THEN RAISE EXCEPTION 'Invalid Square payment status.'; END IF;
 IF _status NOT IN('FAILED','UNKNOWN') AND COALESCE(_payment_id,'')='' THEN RAISE EXCEPTION 'Canonical Square payment identity required.'; END IF;
 IF a.state='paid' THEN RETURN jsonb_build_object('already_paid',true,'state','paid','period_id',p.id); END IF;
 IF _status='COMPLETED' THEN
  IF p.payment_status='paid' AND p.square_payment_id IS DISTINCT FROM _payment_id THEN RAISE EXCEPTION 'Renewal already settled through another payment.'; END IF;
  UPDATE public.square_renewal_payment_attempts SET state='paid',provider_payment_id=_payment_id,settled_at=now() WHERE id=a.id;
  UPDATE public.rental_extension_periods SET payment_status='paid',square_payment_id=_payment_id,paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE id=p.id;
  INSERT INTO public.rental_extension_events(booking_id,extension_plan_id,period_id,event_type,actor_profile_id,after_state,reason,external_reference)
  VALUES(p.booking_id,p.extension_plan_id,p.id,'payment_succeeded',a.created_by_profile_id,jsonb_build_object('checkout_attempt_id',a.id,'provider','square','amount_cents',a.amount_cents),'Guest renewal payment verified with Square',_payment_id);
 ELSE
  next_state:=CASE _status WHEN 'FAILED' THEN 'failed' WHEN 'CANCELED' THEN 'canceled' WHEN 'UNKNOWN' THEN 'reconciliation_required' ELSE 'processing' END;
  UPDATE public.square_renewal_payment_attempts SET state=next_state,provider_payment_id=COALESCE(_payment_id,provider_payment_id) WHERE id=a.id;
  UPDATE public.rental_extension_periods SET payment_status=CASE WHEN next_state IN('processing','reconciliation_required') THEN 'processing' ELSE 'payment_due' END,updated_at=now() WHERE id=p.id AND payment_status<>'paid';
 END IF;
 RETURN jsonb_build_object('period_id',p.id,'state',COALESCE(next_state,'paid'));
END $$;
REVOKE ALL ON FUNCTION public.record_square_renewal_payment(uuid,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_square_renewal_payment(uuid,text,bigint,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_guest_renewal_details(_period_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.rental_extension_periods%ROWTYPE; b public.bookings%ROWTYPE; plan_status text; a public.square_renewal_payment_attempts%ROWTYPE; balance bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to the account used for this reservation.'; END IF;
 SELECT * INTO p FROM public.rental_extension_periods WHERE id=_period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Renewal period not found.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=p.booking_id;
 IF NOT(public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id()) THEN RAISE EXCEPTION 'This renewal belongs to a different account.'; END IF;
 SELECT status INTO plan_status FROM public.rental_extension_plans WHERE id=p.extension_plan_id;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE period_id=p.id ORDER BY generation DESC LIMIT 1;
 balance:=p.amount_due_cents;
 IF p.reservation_change_id IS NOT NULL THEN
  SELECT GREATEST(0,COALESCE(sum(c.adjustment_cents),0)-COALESCE(sum(CASE WHEN ep.payment_status='paid' AND ep.paid_at IS NOT NULL THEN ep.amount_due_cents ELSE 0 END),0)) INTO balance
  FROM public.admin_reservation_changes c LEFT JOIN public.rental_extension_periods ep ON ep.id=c.renewal_period_id WHERE c.booking_id=b.id;
 END IF;
 RETURN jsonb_build_object('period_id',p.id,'reservation_number',b.reservation_number,'period_start',p.period_start,'period_end',p.period_end,'amount_cents',p.amount_due_cents,'currency',p.currency,'payment_status',p.payment_status,'paid_at',p.paid_at,'plan_status',plan_status,'admin_inspection',public.current_profile_is_admin() AND b.renter_profile_id<>public.current_profile_id(),'can_pay',b.renter_profile_id=public.current_profile_id() AND p.payment_status<>'paid' AND b.archived_at IS NULL AND b.trip_status<>'cancelled' AND plan_status='active' AND balance>=p.amount_due_cents,'checkout_state',a.state);
END $$;
REVOKE ALL ON FUNCTION public.get_guest_renewal_details(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_guest_renewal_details(uuid) TO authenticated;


DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.admin_save_reservation_change(uuid,date,time,date,time,text,text,jsonb,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'-- Both historical booking creation and provider claims use these locks.', $guard$
 IF EXISTS(SELECT 1 FROM public.square_renewal_payment_attempts c WHERE c.booking_id=b.id AND c.state IN('processing','reconciliation_required')) THEN RAISE EXCEPTION 'Resolve the existing Square renewal payment before changing dates or pricing.'; END IF;
 -- Both historical booking creation and provider claims use these locks.
 $guard$);
 EXECUTE definition;
END $$;
