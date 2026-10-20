-- Additive partner subsystem: no DML against bookings, payments, or signed agreements.
CREATE SCHEMA IF NOT EXISTS partner_private;
REVOKE ALL ON SCHEMA partner_private FROM PUBLIC,anon,authenticated;
CREATE TABLE public.partner_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), reconciliation_days integer NOT NULL DEFAULT 14 CHECK(reconciliation_days BETWEEN 0 AND 180),
 thresholds_active boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.partner_settings(id) VALUES(true);
CREATE TABLE public.partner_tiers (
 name text PRIMARY KEY CHECK(name IN ('Bronze','Silver','Gold','Platinum')),
 rate_bps integer NOT NULL CHECK(rate_bps IN (300,400,500,600)),
 completed_threshold integer NOT NULL CHECK(completed_threshold>=0)
);
INSERT INTO public.partner_tiers VALUES('Bronze',300,0),('Silver',400,5),('Gold',500,15),('Platinum',600,30);
CREATE TABLE public.partners (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
 contact_name text NOT NULL, business_name text NOT NULL, business_type text NOT NULL, email text NOT NULL, phone text NOT NULL, website text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','suspended')),
 referral_code text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.partner_referrals (
 booking_id uuid PRIMARY KEY REFERENCES public.bookings(id), partner_id uuid NOT NULL REFERENCES public.partners(id),
 attributed_at timestamptz NOT NULL DEFAULT now(), attribution_source text NOT NULL CHECK(attribution_source IN ('link','code','admin')),
 tier_name text, rate_bps integer CHECK(rate_bps BETWEEN 300 AND 600), confirmed_at timestamptz
);
CREATE INDEX partner_referrals_partner ON public.partner_referrals(partner_id);
CREATE TABLE public.partner_commissions (
 booking_id uuid PRIMARY KEY REFERENCES public.partner_referrals(booking_id),
 eligible_net_cents bigint NOT NULL DEFAULT 0 CHECK(eligible_net_cents>=0), commission_cents bigint NOT NULL DEFAULT 0 CHECK(commission_cents>=0),
 settled_at timestamptz, verified_at timestamptz, verification_reference text, source_fingerprint text,
 reconciliation_days integer, payable_at timestamptz, verified_by uuid REFERENCES auth.users(id),
 review_required boolean NOT NULL DEFAULT true
);
CREATE TABLE public.partner_commission_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES public.partner_referrals(booking_id),
 event_type text NOT NULL CHECK(event_type IN ('earned','adjustment','paid','reversal')),
 amount_cents bigint NOT NULL, currency text NOT NULL, reason text NOT NULL, external_reference text,
 request_id uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX partner_payout_reference ON public.partner_commission_ledger(booking_id,external_reference) WHERE event_type='paid';
CREATE INDEX partner_ledger_booking ON public.partner_commission_ledger(booking_id);
CREATE UNIQUE INDEX partner_one_earning ON public.partner_commission_ledger(booking_id) WHERE event_type='earned';
CREATE TABLE public.partner_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor uuid NOT NULL, action text NOT NULL, entity_id text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
-- Only narrowly scoped RPCs expose data. Even authenticated partners cannot query renter tables through this subsystem.
ALTER TABLE public.partner_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_commission_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_settings,public.partner_tiers,public.partners,public.partner_referrals,public.partner_commissions,public.partner_commission_ledger,public.partner_audit FROM anon,authenticated;

CREATE FUNCTION partner_private.fingerprint(_booking uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object('booking',to_jsonb(b),'ledger',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM booking_financial_ledger l WHERE l.booking_id=b.id),'[]'),
 'square',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM booking_payments p WHERE p.booking_id=b.id),'[]'),
 'refunds',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.payment_id) FROM square_payment_operations o JOIN booking_payments p ON p.id=o.payment_id WHERE p.booking_id=b.id),'[]'))::text)
 FROM bookings b WHERE b.id=_booking;
$$;
-- Pure calculation shared by settlement validation and tests. All inputs are integer cents.
CREATE FUNCTION partner_private.calculate(_net bigint,_bps integer) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT floor(_net::numeric*_bps/10000)::bigint $$;
CREATE FUNCTION public.get_partner_program() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('reconciliation_days',s.reconciliation_days,'thresholds_active',s.thresholds_active,'tiers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY rate_bps) FROM partner_tiers t)) FROM partner_settings s;
$$;
CREATE FUNCTION public.apply_partner(_name text,_business text,_type text,_phone text,_website text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); mail text; result uuid;
BEGIN
 SELECT lower(email) INTO mail FROM auth.users WHERE id=uid AND email_confirmed_at IS NOT NULL;
 IF uid IS NULL OR mail IS NULL THEN RAISE EXCEPTION 'Sign in with a verified email before applying.'; END IF;
 IF length(trim(_name)) NOT BETWEEN 2 AND 120 OR length(trim(_business)) NOT BETWEEN 2 AND 160 OR length(trim(_phone)) NOT BETWEEN 7 AND 40 OR _type NOT IN ('Hotel concierge','Vacation rental manager','Hospitality business','Private concierge','Other') THEN RAISE EXCEPTION 'Complete all required application fields.'; END IF;
 IF coalesce(length(_website),0)>300 OR (_website IS NOT NULL AND _website<>'' AND _website!~'^https?://') THEN RAISE EXCEPTION 'Website must begin with https:// or http://.'; END IF;
 INSERT INTO partners(user_id,contact_name,business_name,business_type,email,phone,website) VALUES(uid,trim(_name),trim(_business),_type,mail,trim(_phone),nullif(_website,'')) RETURNING id INTO result;
 INSERT INTO partner_audit(actor,action,entity_id) VALUES(uid,'application',result::text);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'An application already exists for this account. Open your partner dashboard.';
END;$$;
CREATE FUNCTION public.validate_partner_code(_code text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('valid',EXISTS(SELECT 1 FROM partners WHERE referral_code=upper(trim(_code)) AND status='approved'));
$$;
CREATE FUNCTION public.attach_partner_referral(_booking_id uuid,_code text,_source text DEFAULT 'code') RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE b bookings; p partners; uid uuid:=auth.uid(); renter profiles;
BEGIN
 IF uid IS NULL OR _source NOT IN ('link','code','admin') THEN RAISE EXCEPTION 'Unauthorized attribution.'; END IF;
 SELECT * INTO b FROM bookings WHERE id=_booking_id FOR UPDATE;
 SELECT * INTO renter FROM profiles WHERE id=b.renter_profile_id;
 IF b.id IS NULL OR (renter.user_id IS DISTINCT FROM uid AND NOT current_profile_is_admin()) THEN RAISE EXCEPTION 'Booking access denied.'; END IF;
 IF b.trip_status<>'pending_payment' OR b.created_at<now()-interval '24 hours' THEN RAISE EXCEPTION 'Attribution is locked after confirmation or 24 hours.'; END IF;
 SELECT * INTO p FROM partners WHERE referral_code=upper(trim(_code)) AND status='approved';
 IF p.id IS NULL THEN RAISE EXCEPTION 'Referral code is not active.'; END IF;
 IF p.user_id=renter.user_id OR lower(p.email)=lower(renter.email) OR EXISTS(SELECT 1 FROM profiles WHERE id=b.host_profile_id AND user_id=p.user_id) THEN RAISE EXCEPTION 'Self-referrals are not eligible.'; END IF;
 INSERT INTO partner_referrals(booking_id,partner_id,attribution_source) VALUES(b.id,p.id,CASE WHEN current_profile_is_admin() AND _source='admin' THEN 'admin' ELSE CASE WHEN _source='link' THEN 'link' ELSE 'code' END END) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM partner_referrals WHERE booking_id=b.id AND partner_id=p.id) THEN RAISE EXCEPTION 'This booking already has a different partner.'; END IF;
 INSERT INTO partner_commissions(booking_id) VALUES(b.id) ON CONFLICT DO NOTHING;
 RETURN true;
END;$$;
CREATE FUNCTION partner_private.snapshot_confirmation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r partner_referrals; tier partner_tiers; completed bigint;
BEGIN
 IF NEW.trip_status IN ('confirmed','active','completed') AND OLD.trip_status IS DISTINCT FROM NEW.trip_status THEN
  SELECT * INTO r FROM partner_referrals WHERE booking_id=NEW.id FOR UPDATE;
  IF r.booking_id IS NOT NULL AND r.confirmed_at IS NULL THEN
   SELECT count(*) INTO completed FROM partner_referrals pr JOIN bookings b ON b.id=pr.booking_id JOIN partner_commissions c ON c.booking_id=b.id WHERE pr.partner_id=r.partner_id AND b.trip_status='completed' AND c.verified_at IS NOT NULL AND NOT c.review_required AND c.source_fingerprint=partner_private.fingerprint(b.id);
   SELECT * INTO tier FROM partner_tiers WHERE name='Bronze' OR ((SELECT thresholds_active FROM partner_settings) AND completed_threshold<=completed) ORDER BY rate_bps DESC LIMIT 1;
   UPDATE partner_referrals SET tier_name=tier.name,rate_bps=tier.rate_bps,confirmed_at=now() WHERE booking_id=NEW.id;
  END IF;
 END IF; RETURN NEW;
END;$$;
CREATE TRIGGER partner_snapshot_after_confirmation AFTER UPDATE OF trip_status ON public.bookings FOR EACH ROW EXECUTE FUNCTION partner_private.snapshot_confirmation();

CREATE FUNCTION partner_private.booking_report(_partner uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('booking_id',r.booking_id,'partner_id',r.partner_id,'reservation',b.reservation_number,'start_date',b.start_date,'end_date',b.end_date,'trip_status',b.trip_status,'currency',b.currency,'tier',r.tier_name,'rate_bps',r.rate_bps,
 'eligible_net_cents',c.eligible_net_cents,'commission_cents',c.commission_cents,'payable_at',c.payable_at,'verified_at',c.verified_at,
 'paid_cents',(SELECT coalesce(sum(amount_cents),0) FROM partner_commission_ledger WHERE booking_id=b.id AND event_type='paid'),
 'balance_cents',(SELECT coalesce(sum(CASE WHEN event_type='paid' THEN -amount_cents ELSE amount_cents END),0) FROM partner_commission_ledger WHERE booking_id=b.id),
 'state',CASE WHEN b.trip_status='cancelled' THEN 'ineligible' WHEN c.verified_at IS NULL THEN 'pending' WHEN c.review_required OR c.source_fingerprint IS DISTINCT FROM partner_private.fingerprint(b.id) OR b.trip_status<>'completed' THEN 'review_required' WHEN EXISTS(SELECT 1 FROM partners WHERE id=r.partner_id AND status<>'approved') THEN 'suspended' WHEN (SELECT coalesce(sum(amount_cents),0) FROM partner_commission_ledger WHERE booking_id=b.id AND event_type='paid')>c.commission_cents THEN 'recovery_due' WHEN c.commission_cents>0 AND (SELECT coalesce(sum(amount_cents),0) FROM partner_commission_ledger WHERE booking_id=b.id AND event_type='paid')=c.commission_cents THEN 'paid' WHEN c.payable_at>now() THEN 'earned' ELSE 'payable' END) ORDER BY r.attributed_at DESC),'[]') FROM partner_referrals r JOIN bookings b ON b.id=r.booking_id JOIN partner_commissions c ON c.booking_id=b.id WHERE _partner IS NULL OR r.partner_id=_partner;
$$;
CREATE FUNCTION public.get_partner_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE p partners; completed bigint; tier partner_tiers;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;
 SELECT * INTO p FROM partners WHERE user_id=auth.uid();
 IF p.id IS NULL THEN RETURN jsonb_build_object('partner',null); END IF;
 SELECT count(*) INTO completed FROM partner_referrals r JOIN bookings b ON b.id=r.booking_id JOIN partner_commissions c ON c.booking_id=b.id WHERE r.partner_id=p.id AND b.trip_status='completed' AND c.verified_at IS NOT NULL AND NOT c.review_required AND c.source_fingerprint=partner_private.fingerprint(b.id);
 SELECT * INTO tier FROM partner_tiers WHERE name='Bronze' OR ((SELECT thresholds_active FROM partner_settings) AND completed_threshold<=completed) ORDER BY rate_bps DESC LIMIT 1;
 RETURN jsonb_build_object('partner',to_jsonb(p),'tier',tier.name,'rate_bps',tier.rate_bps,'completed',completed,'bookings',CASE WHEN p.status='approved' THEN partner_private.booking_report(p.id) ELSE '[]'::jsonb END);
END;$$;
CREATE FUNCTION public.admin_partner_data() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
BEGIN
 IF NOT current_profile_is_admin() THEN RAISE EXCEPTION 'Admin access required.'; END IF;
 RETURN jsonb_build_object('partners',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY created_at DESC),'[]') FROM partners p),'program',get_partner_program(),'bookings',partner_private.booking_report(),
 'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY created_at DESC),'[]') FROM partner_commission_ledger l),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM (SELECT * FROM partner_audit ORDER BY created_at DESC LIMIT 200) a));
END;$$;
CREATE FUNCTION public.admin_partner_action(_action text,_id uuid DEFAULT NULL,_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE b bookings; r partner_referrals; c partner_commissions; net bigint; amount bigint; adjustment bigint; paid bigint; balance bigint; refs text; settle timestamptz; waitdays integer; req uuid; result uuid; oldjson jsonb;
BEGIN
 IF NOT current_profile_is_admin() THEN RAISE EXCEPTION 'Admin access required.'; END IF;
 IF _action='status' THEN
  IF _payload->>'status' NOT IN ('approved','rejected','suspended') THEN RAISE EXCEPTION 'Invalid partner status.'; END IF;
  SELECT to_jsonb(p) INTO oldjson FROM partners p WHERE id=_id FOR UPDATE;
  UPDATE partners SET status=_payload->>'status',referral_code=CASE WHEN _payload->>'status'='approved' THEN coalesce(referral_code,'ZX'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))) ELSE referral_code END,updated_at=now() WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partner not found.'; END IF;
 ELSIF _action='settings' THEN
  waitdays:=(_payload->>'reconciliation_days')::integer;
  IF waitdays NOT BETWEEN 0 AND 180 THEN RAISE EXCEPTION 'Reconciliation window must be 0–180 days.'; END IF;
  IF (_payload->>'silver')::integer<1 OR (_payload->>'gold')::integer<=(_payload->>'silver')::integer OR (_payload->>'platinum')::integer<=(_payload->>'gold')::integer THEN RAISE EXCEPTION 'Thresholds must increase from Bronze through Platinum.'; END IF;
  SELECT get_partner_program() INTO oldjson;
  UPDATE partner_tiers SET completed_threshold=CASE name WHEN 'Bronze' THEN 0 WHEN 'Silver' THEN (_payload->>'silver')::integer WHEN 'Gold' THEN (_payload->>'gold')::integer ELSE (_payload->>'platinum')::integer END;
  UPDATE partner_settings SET reconciliation_days=waitdays,thresholds_active=coalesce((_payload->>'thresholds_active')::boolean,false),updated_at=now();
 ELSIF _action IN ('verify','adjust','pay','reverse') THEN
  SELECT * INTO r FROM partner_referrals WHERE booking_id=_id FOR UPDATE;
  SELECT * INTO b FROM bookings WHERE id=_id;
  SELECT * INTO c FROM partner_commissions WHERE booking_id=_id FOR UPDATE;
  IF r.booking_id IS NULL THEN RAISE EXCEPTION 'Referral not found.'; END IF;
  refs:=trim(_payload->>'reference');req:=(_payload->>'request_id')::uuid;
  IF req IS NULL OR coalesce(length(trim(_payload->>'reason')),0)<10 OR coalesce(length(refs),0)<5 THEN RAISE EXCEPTION 'Provide a unique request ID, reconciliation reason and evidence / transfer reference.'; END IF;
  IF EXISTS(SELECT 1 FROM partner_commission_ledger WHERE request_id=req AND booking_id=_id) THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
  SELECT coalesce(sum(amount_cents),0) INTO paid FROM partner_commission_ledger WHERE booking_id=_id AND event_type='paid';
  IF _action='verify' THEN
   IF b.trip_status<>'completed' OR r.confirmed_at IS NULL THEN RAISE EXCEPTION 'Rental must be completed with a snapshotted confirmed referral.'; END IF;
   IF NOT EXISTS(SELECT 1 FROM booking_payments WHERE booking_id=_id AND state='paid' AND environment='live' AND provider IN ('square','paypal')) THEN RAISE EXCEPTION 'A confirmed LIVE rental payment is required; authorization holds do not qualify.'; END IF;
   IF NOT coalesce((_payload->>'settlement_verified')::boolean,false) OR NOT coalesce((_payload->>'exclusions_verified')::boolean,false) THEN RAISE EXCEPTION 'Verify final settlement, fraud/disputes, refunds, host share and all exclusions.'; END IF;
   net:=(_payload->>'net_cents')::bigint;settle:=(_payload->>'settled_at')::timestamptz;
   IF net IS NULL OR net<0 OR net>greatest(0,b.subtotal_cents-coalesce(b.refund_amount_cents,0)) OR settle IS NULL OR settle>now() OR settle<b.created_at THEN RAISE EXCEPTION 'Invalid net rental amount or settlement date.'; END IF;
   amount:=partner_private.calculate(net,r.rate_bps);
   SELECT reconciliation_days INTO waitdays FROM partner_settings;
   IF c.verified_at IS NULL THEN
    INSERT INTO partner_commission_ledger(booking_id,event_type,amount_cents,currency,reason,external_reference,request_id,created_by) VALUES(_id,'earned',amount,b.currency,_payload->>'reason',refs,req,auth.uid());
   ELSE
    adjustment:=amount-c.commission_cents;
    INSERT INTO partner_commission_ledger(booking_id,event_type,amount_cents,currency,reason,external_reference,request_id,created_by) VALUES(_id,'adjustment',adjustment,b.currency,_payload->>'reason',refs,req,auth.uid());
   END IF;
   UPDATE partner_commissions SET eligible_net_cents=net,commission_cents=amount,settled_at=settle,verified_at=now(),verification_reference=refs,source_fingerprint=partner_private.fingerprint(_id),reconciliation_days=waitdays,payable_at=greatest(settle,coalesce(b.returned_at,b.end_date::timestamptz))+make_interval(days=>waitdays),verified_by=auth.uid(),review_required=false WHERE booking_id=_id;
  ELSIF _action='reverse' THEN
   INSERT INTO partner_commission_ledger(booking_id,event_type,amount_cents,currency,reason,external_reference,request_id,created_by) VALUES(_id,'reversal',-c.commission_cents,b.currency,_payload->>'reason',refs,req,auth.uid());
   UPDATE partner_commissions SET commission_cents=0,eligible_net_cents=0,review_required=true WHERE booking_id=_id;
  ELSIF _action='adjust' THEN
   RAISE EXCEPTION 'Use Verify / reconcile with the corrected net amount. A signed ledger adjustment is recorded automatically.';
  ELSE
   IF c.verified_at IS NULL OR c.review_required OR c.source_fingerprint IS DISTINCT FROM partner_private.fingerprint(_id) OR b.trip_status<>'completed' OR c.payable_at>now() OR NOT EXISTS(SELECT 1 FROM partners WHERE id=r.partner_id AND status='approved') THEN RAISE EXCEPTION 'Commission is not payable. Reconcile settlement and wait for the reconciliation window.'; END IF;
   balance:=c.commission_cents-paid;amount:=(_payload->>'amount_cents')::bigint;
   IF amount IS NULL OR amount<=0 OR amount>balance THEN RAISE EXCEPTION 'Payout exceeds the available commission balance.'; END IF;
   INSERT INTO partner_commission_ledger(booking_id,event_type,amount_cents,currency,reason,external_reference,request_id,created_by) VALUES(_id,'paid',amount,b.currency,_payload->>'reason',refs,req,auth.uid());
  END IF;
 ELSE RAISE EXCEPTION 'Unknown partner action.';
 END IF;
 INSERT INTO partner_audit(actor,action,entity_id,details) VALUES(auth.uid(),_action,coalesce(_id::text,'settings'),jsonb_build_object('before',oldjson,'request',_payload));
 RETURN jsonb_build_object('ok',true);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA partner_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_partner_program(),public.apply_partner(text,text,text,text,text),public.validate_partner_code(text),public.attach_partner_referral(uuid,text,text),public.get_partner_dashboard(),public.admin_partner_data(),public.admin_partner_action(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_program(),public.validate_partner_code(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_partner(text,text,text,text,text),public.attach_partner_referral(uuid,text,text),public.get_partner_dashboard(),public.admin_partner_data(),public.admin_partner_action(text,uuid,jsonb) TO authenticated;
