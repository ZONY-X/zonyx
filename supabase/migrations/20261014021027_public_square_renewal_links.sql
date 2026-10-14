-- Possession of a random, unguessable link authorizes this renewal payment only.
CREATE TABLE public.square_renewal_payment_links (
 period_id uuid PRIMARY KEY REFERENCES public.rental_extension_periods(id) ON DELETE RESTRICT,
 token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32),'hex') CHECK(token ~ '^[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.square_renewal_payment_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_renewal_payment_links FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.square_renewal_payment_links TO service_role;
ALTER TABLE public.square_renewal_payment_attempts ALTER COLUMN created_by_profile_id DROP NOT NULL;
CREATE FUNCTION public.ensure_square_renewal_link(_period_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token_value text;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rental_extension_periods WHERE id=_period_id) THEN RAISE EXCEPTION 'Renewal not found.'; END IF;
 INSERT INTO public.square_renewal_payment_links(period_id) VALUES(_period_id) ON CONFLICT(period_id) DO NOTHING;
 SELECT token INTO token_value FROM public.square_renewal_payment_links WHERE period_id=_period_id AND enabled;
 IF token_value IS NULL THEN RAISE EXCEPTION 'Payment link unavailable.'; END IF;
 RETURN token_value;
END $$;
REVOKE ALL ON FUNCTION public.ensure_square_renewal_link(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_square_renewal_link(uuid) TO service_role;

CREATE FUNCTION public.get_public_square_renewal_details(_token text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.rental_extension_periods%ROWTYPE; b public.bookings%ROWTYPE; plan_status text; a public.square_renewal_payment_attempts%ROWTYPE; balance bigint;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT * INTO p FROM public.rental_extension_periods WHERE id=(SELECT period_id FROM public.square_renewal_payment_links WHERE token=_token AND enabled);
 IF NOT FOUND THEN RAISE EXCEPTION 'Renewal period not found.'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=p.booking_id;

 SELECT status INTO plan_status FROM public.rental_extension_plans WHERE id=p.extension_plan_id;
 SELECT * INTO a FROM public.square_renewal_payment_attempts WHERE period_id=p.id ORDER BY generation DESC LIMIT 1;
 balance:=p.amount_due_cents;
 IF p.reservation_change_id IS NOT NULL THEN
  SELECT GREATEST(0,COALESCE(sum(c.adjustment_cents),0)-COALESCE(sum(CASE WHEN ep.payment_status='paid' AND ep.paid_at IS NOT NULL THEN ep.amount_due_cents ELSE 0 END),0)) INTO balance
  FROM public.admin_reservation_changes c LEFT JOIN public.rental_extension_periods ep ON ep.id=c.renewal_period_id WHERE c.booking_id=b.id;
 END IF;
 RETURN jsonb_build_object('period_id',p.id,'reservation_number',b.reservation_number,'period_start',p.period_start,'period_end',p.period_end,'amount_cents',p.amount_due_cents,'currency',p.currency,'payment_status',p.payment_status,'paid_at',p.paid_at,'plan_status',plan_status,'description','ZONYX Rental Renewal','public_link',true,'can_pay', p.payment_status<>'paid' AND b.archived_at IS NULL AND b.trip_status<>'cancelled' AND plan_status='active' AND balance>=p.amount_due_cents,'checkout_state',a.state);
END $$;
REVOKE ALL ON FUNCTION public.get_public_square_renewal_details(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_square_renewal_details(text) TO service_role;

CREATE FUNCTION public.prepare_public_square_renewal_payment(_token text,_environment text,_location_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE period uuid; guest_user uuid; prepared jsonb;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'Service role required.'; END IF;
 SELECT l.period_id,pr.user_id INTO period,guest_user FROM public.square_renewal_payment_links l JOIN public.rental_extension_periods p ON p.id=l.period_id JOIN public.bookings b ON b.id=p.booking_id JOIN public.profiles pr ON pr.id=b.renter_profile_id WHERE l.token=_token AND l.enabled;
 IF period IS NULL THEN RAISE EXCEPTION 'Payment link unavailable.'; END IF;
 -- The existing serialized claim owns exact price, eligibility and duplicate prevention.
 prepared:=public.prepare_square_renewal_payment(period,guest_user,_environment,_location_id);
 IF COALESCE((prepared->>'dispatch')::boolean,false) THEN
  UPDATE public.square_renewal_payment_attempts SET created_by_profile_id=NULL WHERE id=(prepared->>'id')::uuid;
 END IF;
 RETURN prepared;
END $$;
REVOKE ALL ON FUNCTION public.prepare_public_square_renewal_payment(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_public_square_renewal_payment(text,text,text) TO service_role;
