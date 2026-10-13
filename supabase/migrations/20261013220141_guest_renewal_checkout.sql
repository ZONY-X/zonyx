-- Isolated guest-approved renewal collection. No original booking/payment/deposit writes.
CREATE TABLE public.renewal_checkout_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES public.rental_extension_periods(id) ON DELETE RESTRICT,
 booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
 generation integer NOT NULL CHECK(generation>0),
 amount_cents bigint NOT NULL CHECK(amount_cents>=50),
 currency text NOT NULL CHECK(currency='usd'),
 livemode boolean NOT NULL,
 state text NOT NULL DEFAULT 'creating' CHECK(state IN('creating','open','processing','paid','expired','failed')),
 idempotency_key text NOT NULL UNIQUE,
 stripe_session_id text UNIQUE,
 stripe_url text,
 stripe_payment_intent_id text UNIQUE,
 session_expires_at timestamptz,
 created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 UNIQUE(period_id,generation)
);
CREATE UNIQUE INDEX renewal_checkout_one_live_attempt_idx ON public.renewal_checkout_attempts(period_id) WHERE state IN('creating','open','processing');
ALTER TABLE public.renewal_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renewal_checkout_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.renewal_checkout_attempts TO service_role;

CREATE FUNCTION public.get_guest_renewal_details(_period_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.rental_extension_periods%ROWTYPE; b public.bookings%ROWTYPE; plan_status text; a public.renewal_checkout_attempts%ROWTYPE; balance bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to the account used for this reservation.'; END IF;
 SELECT * INTO p FROM public.rental_extension_periods WHERE id=_period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Renewal period not found.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=p.booking_id;
 IF NOT(public.current_profile_is_admin() OR b.renter_profile_id=public.current_profile_id()) THEN RAISE EXCEPTION 'This renewal belongs to a different account.'; END IF;
 SELECT status INTO plan_status FROM public.rental_extension_plans WHERE id=p.extension_plan_id;
 SELECT * INTO a FROM public.renewal_checkout_attempts WHERE period_id=p.id ORDER BY generation DESC LIMIT 1;
 balance:=p.amount_due_cents;
 IF p.reservation_change_id IS NOT NULL THEN
  SELECT GREATEST(0,COALESCE(sum(c.adjustment_cents),0)-COALESCE(sum(CASE WHEN ep.payment_status='paid' AND ep.paid_at IS NOT NULL THEN ep.amount_due_cents ELSE 0 END),0)) INTO balance
  FROM public.admin_reservation_changes c LEFT JOIN public.rental_extension_periods ep ON ep.id=c.renewal_period_id WHERE c.booking_id=b.id;
 END IF;
 RETURN jsonb_build_object('period_id',p.id,'reservation_number',b.reservation_number,'period_start',p.period_start,'period_end',p.period_end,'amount_cents',p.amount_due_cents,'currency',p.currency,'payment_status',p.payment_status,'paid_at',p.paid_at,'plan_status',plan_status,'can_pay',p.payment_status<>'paid' AND b.archived_at IS NULL AND b.trip_status<>'cancelled' AND plan_status='active' AND balance>=p.amount_due_cents,'checkout_state',a.state);
END $$;
REVOKE ALL ON FUNCTION public.get_guest_renewal_details(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_guest_renewal_details(uuid) TO authenticated;

CREATE FUNCTION public.prepare_guest_renewal_checkout(_period_id uuid,_user_id uuid,_livemode boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.rental_extension_periods%ROWTYPE; b public.bookings%ROWTYPE; a public.renewal_checkout_attempts%ROWTYPE; actor uuid; n integer; plan_status text; balance bigint; email text;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT b0.* INTO b FROM public.bookings b0 JOIN public.rental_extension_periods p0 ON p0.booking_id=b0.id WHERE p0.id=_period_id FOR UPDATE OF b0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Renewal period not found.'; END IF;
 SELECT id INTO actor FROM public.profiles WHERE user_id=_user_id AND id=b.renter_profile_id;
 IF actor IS NULL THEN RAISE EXCEPTION 'Only the reservation guest can initiate this payment.'; END IF;
 SELECT * INTO p FROM public.rental_extension_periods WHERE id=_period_id FOR UPDATE;
 IF p.payment_status='paid' THEN RETURN jsonb_build_object('already_paid',true,'period_id',p.id); END IF;
 SELECT status INTO plan_status FROM public.rental_extension_plans WHERE id=p.extension_plan_id;
 IF plan_status<>'active' OR b.archived_at IS NOT NULL OR b.trip_status='cancelled' THEN RAISE EXCEPTION 'This extension is not active or is no longer payable.'; END IF;
 IF p.amount_due_cents<50 OR p.currency<>'usd' THEN RAISE EXCEPTION 'Renewal amount or currency requires review.'; END IF;
 IF EXISTS(SELECT 1 FROM public.rental_renewal_payment_attempts r WHERE r.period_id=p.id AND r.status IN('prepared','reconciliation_required','succeeded')) THEN RAISE EXCEPTION 'An existing renewal payment requires a status check before another collection.'; END IF;
 IF p.reservation_change_id IS NOT NULL THEN
  SELECT GREATEST(0,COALESCE(sum(c.adjustment_cents),0)-COALESCE(sum(CASE WHEN ep.payment_status='paid' AND ep.paid_at IS NOT NULL THEN ep.amount_due_cents ELSE 0 END),0)) INTO balance FROM public.admin_reservation_changes c LEFT JOIN public.rental_extension_periods ep ON ep.id=c.renewal_period_id WHERE c.booking_id=b.id;
  IF balance<p.amount_due_cents THEN RAISE EXCEPTION 'A reservation credit reduced this balance. Contact ZONYX for the corrected payment amount.'; END IF;
 END IF;
 SELECT * INTO a FROM public.renewal_checkout_attempts WHERE period_id=p.id AND state IN('creating','open','processing') FOR UPDATE;
 IF FOUND THEN
  IF a.amount_cents<>p.amount_due_cents OR a.currency<>p.currency OR a.livemode<>_livemode THEN RAISE EXCEPTION 'Existing checkout terms require reconciliation.'; END IF;
 ELSE
  SELECT COALESCE(max(generation),0)+1 INTO n FROM public.renewal_checkout_attempts WHERE period_id=p.id;
  INSERT INTO public.renewal_checkout_attempts(period_id,booking_id,generation,amount_cents,currency,livemode,idempotency_key,created_by_profile_id)
  VALUES(p.id,b.id,n,p.amount_due_cents,p.currency,_livemode,'guest-renewal/'||p.id||'/'||n,actor) RETURNING * INTO a;
 END IF;
 SELECT pr.email INTO email FROM public.profiles pr WHERE pr.id=b.renter_profile_id;
 RETURN jsonb_build_object('already_paid',false,'attempt_id',a.id,'period_id',p.id,'amount_cents',a.amount_cents,'currency',a.currency,'livemode',a.livemode,'generation',a.generation,'created_at',a.created_at,'idempotency_key',a.idempotency_key,'session_id',a.stripe_session_id,'session_url',a.stripe_url,'state',a.state,'reservation_number',b.reservation_number,'period_start',p.period_start,'period_end',p.period_end,'guest_email',email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_guest_renewal_checkout(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_guest_renewal_checkout(uuid,uuid,boolean) TO service_role;

CREATE FUNCTION public.attach_guest_renewal_session(_attempt_id uuid,_session_id text,_session_url text,_expires_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.renewal_checkout_attempts%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO a FROM public.renewal_checkout_attempts WHERE id=_attempt_id FOR UPDATE;
 IF NOT FOUND OR _session_id IS NULL OR _session_id NOT LIKE (CASE WHEN a.livemode THEN 'cs_live_%' ELSE 'cs_test_%' END) OR _session_url IS NULL OR _session_url NOT LIKE 'https://checkout.stripe.com/%' OR _expires_at IS NULL THEN RAISE EXCEPTION 'Checkout identity conflicts.'; END IF;
 IF a.stripe_session_id IS NOT NULL AND a.stripe_session_id<>_session_id THEN RAISE EXCEPTION 'Existing checkout session cannot be replaced.'; END IF;
 UPDATE public.renewal_checkout_attempts SET stripe_session_id=_session_id,stripe_url=_session_url,session_expires_at=_expires_at,state=CASE WHEN state='creating' THEN 'open' ELSE state END WHERE id=a.id;
END $$;
REVOKE ALL ON FUNCTION public.attach_guest_renewal_session(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_guest_renewal_session(uuid,text,text,timestamptz) TO service_role;

CREATE FUNCTION public.record_guest_renewal_evidence(_attempt_id uuid,_session_id text,_payment_intent_id text,_amount_cents bigint,_currency text,_livemode boolean,_status text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.renewal_checkout_attempts%ROWTYPE; p public.rental_extension_periods%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 -- Serialize settlement against the original Admin collection path on this period.
 SELECT p0.* INTO p FROM public.rental_extension_periods p0 JOIN public.renewal_checkout_attempts a0 ON a0.period_id=p0.id WHERE a0.id=_attempt_id FOR UPDATE OF p0;
 SELECT * INTO a FROM public.renewal_checkout_attempts WHERE id=_attempt_id FOR UPDATE;
 IF a.id IS NULL OR a.stripe_session_id IS DISTINCT FROM _session_id OR a.amount_cents IS DISTINCT FROM _amount_cents OR a.currency IS DISTINCT FROM _currency OR a.livemode IS DISTINCT FROM _livemode OR p.amount_due_cents<>a.amount_cents OR p.currency<>a.currency THEN RAISE EXCEPTION 'Renewal settlement evidence conflicts.'; END IF;
 IF _status NOT IN('paid','processing','expired','failed') THEN RAISE EXCEPTION 'Invalid checkout evidence state.'; END IF;
 IF a.state='paid' THEN
  IF _status='paid' AND a.stripe_payment_intent_id IS DISTINCT FROM _payment_intent_id THEN RAISE EXCEPTION 'Payment identity conflicts.'; END IF;
  RETURN jsonb_build_object('already_paid',true,'period_id',p.id);
 END IF;
 IF _status='paid' THEN
  IF _payment_intent_id IS NULL OR _payment_intent_id NOT LIKE 'pi_%' THEN RAISE EXCEPTION 'Confirmed PaymentIntent required.'; END IF;
  IF p.payment_status='paid' AND p.stripe_payment_intent_id IS DISTINCT FROM _payment_intent_id THEN RAISE EXCEPTION 'Renewal already settled through another payment.'; END IF;
  UPDATE public.renewal_checkout_attempts SET state='paid',stripe_payment_intent_id=_payment_intent_id,settled_at=now() WHERE id=a.id;
  UPDATE public.rental_extension_periods SET payment_status='paid',stripe_payment_intent_id=_payment_intent_id,paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE id=p.id;
  INSERT INTO public.rental_extension_events(booking_id,extension_plan_id,period_id,event_type,actor_profile_id,after_state,reason,external_reference)
  VALUES(p.booking_id,p.extension_plan_id,p.id,'payment_succeeded',a.created_by_profile_id,jsonb_build_object('checkout_attempt_id',a.id,'session_id',_session_id,'amount_cents',a.amount_cents,'collection','guest_checkout'),'Guest-confirmed renewal payment verified with Stripe',_payment_intent_id);
 ELSE
  -- Late expired/failed notifications cannot downgrade paid/processing outcomes.
  IF a.state='processing' AND _status='expired' THEN RETURN jsonb_build_object('ignored',true); END IF;
  UPDATE public.renewal_checkout_attempts SET state=_status WHERE id=a.id;
  UPDATE public.rental_extension_periods SET payment_status=CASE WHEN _status='processing' THEN 'processing' ELSE 'payment_due' END,updated_at=now() WHERE id=p.id AND payment_status<>'paid';
 END IF;
 RETURN jsonb_build_object('period_id',p.id,'state',_status,'already_paid',false);
END $$;
REVOKE ALL ON FUNCTION public.record_guest_renewal_evidence(uuid,text,text,bigint,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_guest_renewal_evidence(uuid,text,text,bigint,text,boolean,text) TO service_role;

-- Prevent a second collection method from charging while Guest checkout is active.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.admin_prepare_renewal_payment(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'actor:=public.current_profile_id();', $guard$
 IF EXISTS(SELECT 1 FROM public.renewal_checkout_attempts c WHERE c.period_id=x.id AND c.state IN('creating','open','processing')) THEN RAISE EXCEPTION 'Guest renewal checkout already exists. Check that payment before collecting again.'; END IF;
 actor:=public.current_profile_id();
 $guard$);
 EXECUTE definition;
 SELECT pg_get_functiondef('public.admin_save_reservation_change(uuid,date,time,date,time,text,text,jsonb,uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'-- Both historical booking creation and provider claims use these locks.', $guard$
 IF EXISTS(SELECT 1 FROM public.renewal_checkout_attempts c WHERE c.booking_id=b.id AND c.state IN('creating','open','processing')) THEN RAISE EXCEPTION 'Resolve the open renewal checkout before changing dates or pricing.'; END IF;
 -- Both historical booking creation and provider claims use these locks.
 $guard$);
 EXECUTE definition;
END $$;
