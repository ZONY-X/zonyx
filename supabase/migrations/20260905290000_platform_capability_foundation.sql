-- Phase 1: additive staff capability foundation.
-- The existing hardened current_profile_is_admin() Owner root is intentionally unchanged.

CREATE TABLE public.platform_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key IN ('operations','finance')),
  name text NOT NULL,
  description text NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_.]+$'),
  description text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('operational','financial','owner')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_role_capabilities (
  role_id uuid NOT NULL REFERENCES public.platform_roles(id) ON DELETE RESTRICT,
  capability_id uuid NOT NULL REFERENCES public.platform_capabilities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id,capability_id)
);

CREATE TABLE public.profile_platform_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES public.platform_roles(id) ON DELETE RESTRICT,
  assigned_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason))>=5),
  revoke_reason text,
  CHECK ((revoked_at IS NULL AND revoked_by_profile_id IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by_profile_id IS NOT NULL AND length(btrim(revoke_reason))>=5))
);
CREATE UNIQUE INDEX profile_platform_roles_one_active_role ON public.profile_platform_roles(profile_id,role_id) WHERE revoked_at IS NULL;

CREATE TABLE public.platform_role_assignment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.profile_platform_roles(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES public.platform_roles(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('assigned','revoked')),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason))>=5),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_role_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_role_assignment_audit ENABLE ROW LEVEL SECURITY;

-- Browser roles use constrained SECURITY DEFINER helpers only.
REVOKE ALL ON public.platform_roles,public.platform_capabilities,public.platform_role_capabilities,public.profile_platform_roles,public.platform_role_assignment_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.platform_roles,public.platform_capabilities,public.platform_role_capabilities,public.profile_platform_roles,public.platform_role_assignment_audit FROM service_role;
GRANT SELECT ON public.platform_roles,public.platform_capabilities,public.platform_role_capabilities,public.profile_platform_roles,public.platform_role_assignment_audit TO service_role;

INSERT INTO public.platform_roles(key,name,description) VALUES
('operations','Operations','Booking, trip, vehicle and customer-support operations without financial authority.'),
('finance','Finance','Financial inspection, reconciliation and explicitly authorized money-management operations without Owner authority.');

INSERT INTO public.platform_capabilities(key,description,risk_level) VALUES
('operations.workspace.access','Access the Operations workspace.','operational'),
('bookings.read_all','Read platform booking operational projections.','operational'),
('bookings.search_all','Search platform bookings.','operational'),
('bookings.view_operational_identity','View Guest and Host operational identity.','operational'),
('bookings.correct_schedule','Correct booking schedule with audit.','operational'),
('bookings.correct_locations','Correct booking locations with audit.','operational'),
('bookings.correct_fulfillment','Correct fulfillment method with audit.','operational'),
('trips.start','Start an eligible trip.','operational'),
('trips.mark_returned','Mark an active trip returned.','operational'),
('trips.complete','Complete a returned trip.','operational'),
('vehicles.read_all','Read all platform vehicles.','operational'),
('vehicles.edit_listing','Edit non-financial listing fields.','operational'),
('vehicles.manage_photos','Manage listing photos.','operational'),
('vehicles.manage_availability','Manage vehicle availability.','operational'),
('vehicles.set_active','Activate or deactivate listings.','operational'),
('vehicles.manage_display_order','Manage fleet display order.','operational'),
('accounts.read_operational','Read approved operational account fields.','operational'),
('after_trip.read_all','Read all after-trip charge requests.','operational'),
('after_trip.review','Review after-trip evidence and status.','operational'),
('after_trip.mark_disputed','Mark an after-trip request disputed.','operational'),
('receipts.read_all','Read participant-safe final receipts.','operational'),
('financial_summary.read_all','Read normalized financial summaries.','operational'),
('finance.workspace.access','Access the Finance workspace.','financial'),
('stripe.inspect','Inspect Stripe through GET-only tooling.','financial'),
('financial_reconciliation.prepare','Prepare financial reconciliation.','financial'),
('financial_reconciliation.confirm','Confirm immutable financial reconciliation.','financial'),
('financial_reconciliation.approve_ambiguous','Approve ambiguous Stripe associations.','financial'),
('deposit.capture','Capture an authorized security deposit.','financial'),
('deposit.release','Release an authorized security deposit.','financial'),
('refund.execute','Execute a policy-authorized refund.','financial'),
('refund.override','Override refund policy where separately permitted.','financial'),
('after_trip.allocate_settlement','Allocate proven settlement evidence.','financial'),
('after_trip.historical_reconcile','Reconcile historical after-trip financial truth.','financial'),
('after_trip.waive','Waive an after-trip balance with audit.','financial'),
('after_trip.void','Void an after-trip balance with audit.','financial'),
('outstanding_balance.collect','Collect an outstanding balance through a future approved workflow.','financial'),
('booking.correct_price','Correct booking financial components.','financial'),
('promo.manage','Manage platform discounts.','financial'),
('ledger.read_raw','Read raw immutable financial ledger entries.','financial'),
('reconciliation.read_raw','Read raw reconciliation source records.','financial'),
('financial_audit.read_raw','Read raw financial audit records.','financial'),
('payment_links.override','Use future elevated payment-link controls.','financial'),
('owner.assign_platform_roles','Assign platform staff roles.','owner'),
('owner.revoke_platform_roles','Revoke platform staff roles.','owner'),
('owner.manage_host_approval','Manage Host approval.','owner'),
('owner.change_vehicle_provider','Change vehicle provider ownership.','owner'),
('owner.delete_booking','Permanently delete a booking.','owner'),
('owner.delete_vehicle','Permanently delete a vehicle.','owner'),
('owner.manage_system_configuration','Manage system configuration.','owner'),
('owner.access_legacy_diagnostics','Access approved legacy diagnostics.','owner');

INSERT INTO public.platform_role_capabilities(role_id,capability_id)
SELECT r.id,c.id FROM public.platform_roles r CROSS JOIN public.platform_capabilities c
WHERE (r.key='operations' AND c.risk_level='operational')
   OR (r.key='finance' AND c.risk_level='financial');

CREATE OR REPLACE FUNCTION public.current_profile_has_capability(_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.platform_capabilities c WHERE c.key=_capability)
    AND (public.current_profile_is_admin() OR EXISTS(
      SELECT 1 FROM public.profile_platform_roles a
      JOIN public.platform_role_capabilities rc ON rc.role_id=a.role_id
      JOIN public.platform_capabilities c ON c.id=rc.capability_id
      JOIN public.profiles p ON p.id=a.profile_id
      WHERE p.user_id=auth.uid() AND a.revoked_at IS NULL AND c.key=_capability
    ));
$$;
REVOKE ALL ON FUNCTION public.current_profile_has_capability(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_profile_has_capability(text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_my_platform_capabilities()
RETURNS TABLE(role_key text,capability_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'owner'::text AS role_key,c.key AS capability_key FROM public.platform_capabilities c
  WHERE public.current_profile_is_admin()
  UNION
  SELECT r.key,c.key FROM public.profile_platform_roles a
    JOIN public.platform_roles r ON r.id=a.role_id
    JOIN public.platform_role_capabilities rc ON rc.role_id=r.id
    JOIN public.platform_capabilities c ON c.id=rc.capability_id
    JOIN public.profiles p ON p.id=a.profile_id
    WHERE p.user_id=auth.uid() AND a.revoked_at IS NULL
  ORDER BY 1,2;
$$;
REVOKE ALL ON FUNCTION public.get_my_platform_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_platform_capabilities() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.owner_assign_platform_role(_profile_id uuid,_role_key text,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; target_role_id uuid; assignment_id uuid;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Owner authority required.'; END IF;
  IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Assignment reason is required.'; END IF;
  SELECT public.current_profile_id() INTO actor;
  SELECT id INTO target_role_id FROM public.platform_roles WHERE key=_role_key;
  IF target_role_id IS NULL THEN RAISE EXCEPTION 'Unknown platform role.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=_profile_id) THEN RAISE EXCEPTION 'Profile not found.'; END IF;
  SELECT id INTO assignment_id FROM public.profile_platform_roles WHERE profile_id=_profile_id AND role_id=target_role_id AND revoked_at IS NULL;
  IF assignment_id IS NOT NULL THEN RETURN assignment_id; END IF;
  INSERT INTO public.profile_platform_roles(profile_id,role_id,assigned_by_profile_id,reason) VALUES(_profile_id,target_role_id,actor,btrim(_reason)) RETURNING id INTO assignment_id;
  INSERT INTO public.platform_role_assignment_audit(assignment_id,profile_id,role_id,action,actor_profile_id,reason,before_state,after_state)
  VALUES(assignment_id,_profile_id,target_role_id,'assigned',actor,btrim(_reason),'{}',jsonb_build_object('role_key',_role_key,'active',true));
  RETURN assignment_id;
END; $$;

CREATE OR REPLACE FUNCTION public.owner_revoke_platform_role(_profile_id uuid,_role_key text,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; target_role_id uuid; assignment public.profile_platform_roles%ROWTYPE;
BEGIN
  IF NOT public.current_profile_is_admin() THEN RAISE EXCEPTION 'Owner authority required.'; END IF;
  IF length(btrim(COALESCE(_reason,'')))<5 THEN RAISE EXCEPTION 'Revocation reason is required.'; END IF;
  SELECT public.current_profile_id() INTO actor;
  SELECT id INTO target_role_id FROM public.platform_roles WHERE key=_role_key;
  IF target_role_id IS NULL THEN RAISE EXCEPTION 'Unknown platform role.'; END IF;
  SELECT * INTO assignment FROM public.profile_platform_roles WHERE profile_id=_profile_id AND role_id=target_role_id AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.profile_platform_roles SET revoked_at=now(),revoked_by_profile_id=actor,revoke_reason=btrim(_reason) WHERE id=assignment.id;
  INSERT INTO public.platform_role_assignment_audit(assignment_id,profile_id,role_id,action,actor_profile_id,reason,before_state,after_state)
  VALUES(assignment.id,_profile_id,target_role_id,'revoked',actor,btrim(_reason),jsonb_build_object('role_key',_role_key,'active',true),jsonb_build_object('role_key',_role_key,'active',false));
END; $$;

REVOKE ALL ON FUNCTION public.owner_assign_platform_role(uuid,text,text),public.owner_revoke_platform_role(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_assign_platform_role(uuid,text,text),public.owner_revoke_platform_role(uuid,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.prevent_platform_authorization_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Platform authorization history is immutable.'; END; $$;
CREATE TRIGGER prevent_platform_role_audit_mutation BEFORE UPDATE OR DELETE ON public.platform_role_assignment_audit FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_authorization_history_mutation();