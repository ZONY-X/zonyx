DO $test$
DECLARE owner_profile uuid; owner_user uuid; ordinary_profile uuid; ordinary_user uuid; assignment uuid; assignment2 uuid; admin_md5_before text; audit_count integer;
BEGIN
  SELECT p.id,p.user_id INTO owner_profile,owner_user FROM public.profiles p JOIN auth.users u ON u.id=p.user_id WHERE p.is_admin AND lower(p.email)='zoeysnp@gmail.com' AND lower(u.email)='zoeysnp@gmail.com';
  SELECT id,user_id INTO ordinary_profile,ordinary_user FROM public.profiles WHERE id<>owner_profile ORDER BY created_at LIMIT 1;
  IF owner_profile IS NULL OR ordinary_profile IS NULL THEN RAISE EXCEPTION 'Required fixtures unavailable.'; END IF;
  IF (SELECT count(*) FROM public.profile_platform_roles WHERE revoked_at IS NULL)<>0 THEN RAISE EXCEPTION 'Phase 1 must seed no assignments.'; END IF;
  IF (SELECT count(*) FROM public.platform_roles)<>2 OR (SELECT count(*) FROM public.platform_capabilities WHERE risk_level='operational')=0 OR (SELECT count(*) FROM public.platform_capabilities WHERE risk_level='financial')=0 THEN RAISE EXCEPTION 'Role/capability seed incomplete.'; END IF;

  PERFORM set_config('role','authenticated',true); PERFORM set_config('request.jwt.claim.sub',ordinary_user::text,true);
  IF current_profile_is_admin() OR current_profile_has_capability('operations.workspace.access') OR current_profile_has_capability('finance.workspace.access') OR current_profile_has_capability('owner.assign_platform_roles') THEN RAISE EXCEPTION 'Ordinary account received implicit authority.'; END IF;
  IF EXISTS(SELECT 1 FROM get_my_platform_capabilities()) THEN RAISE EXCEPTION 'Ordinary account has implicit capabilities.'; END IF;
  BEGIN PERFORM owner_assign_platform_role(ordinary_profile,'operations','Self assignment attempt'); RAISE EXCEPTION 'Non-owner assigned role.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='Non-owner assigned role.' THEN RAISE; END IF; END;
  BEGIN INSERT INTO public.profile_platform_roles(profile_id,role_id,assigned_by_profile_id,reason) SELECT ordinary_profile,id,ordinary_profile,'Direct spoof' FROM public.platform_roles WHERE key='operations'; RAISE EXCEPTION 'Direct assignment allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='Direct assignment allowed.' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claim.sub',owner_user::text,true);
  IF NOT current_profile_is_admin() THEN RAISE EXCEPTION 'Owner root lost.'; END IF;
  IF NOT current_profile_has_capability('operations.workspace.access') OR NOT current_profile_has_capability('deposit.capture') OR NOT current_profile_has_capability('owner.assign_platform_roles') THEN RAISE EXCEPTION 'Owner compatibility failed.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM get_my_platform_capabilities() WHERE role_key='owner' AND capability_key='owner.assign_platform_roles') THEN RAISE EXCEPTION 'Owner capability introspection failed.'; END IF;
  IF current_profile_has_capability('not.a.real.capability') THEN RAISE EXCEPTION 'Unknown capability granted.'; END IF;
  assignment:=owner_assign_platform_role(ordinary_profile,'operations','Synthetic operations assignment');
  assignment2:=owner_assign_platform_role(ordinary_profile,'operations','Idempotent retry reason');
  IF assignment<>assignment2 THEN RAISE EXCEPTION 'Assignment idempotency failed.'; END IF;

  PERFORM set_config('request.jwt.claim.sub',ordinary_user::text,true);
  IF current_profile_is_admin() THEN RAISE EXCEPTION 'Operations assignment granted Admin.'; END IF;
  IF NOT current_profile_has_capability('operations.workspace.access') OR NOT current_profile_has_capability('trips.start') THEN RAISE EXCEPTION 'Operations capability missing.'; END IF;
  IF current_profile_has_capability('finance.workspace.access') OR current_profile_has_capability('stripe.inspect') OR current_profile_has_capability('deposit.capture') OR current_profile_has_capability('refund.execute') OR current_profile_has_capability('owner.assign_platform_roles') THEN RAISE EXCEPTION 'Operations leaked Finance/Owner authority.'; END IF;
  IF (SELECT can_admin FROM get_my_account_capabilities()) THEN RAISE EXCEPTION 'Operations assignment exposed Admin mode.'; END IF;

  PERFORM set_config('request.jwt.claim.sub',owner_user::text,true);
  PERFORM owner_revoke_platform_role(ordinary_profile,'operations','Synthetic operations revocation');
  PERFORM owner_revoke_platform_role(ordinary_profile,'operations','Idempotent revoke retry');
  assignment:=owner_assign_platform_role(ordinary_profile,'finance','Synthetic finance assignment');
  PERFORM set_config('request.jwt.claim.sub',ordinary_user::text,true);
  IF current_profile_is_admin() THEN RAISE EXCEPTION 'Finance assignment granted Admin.'; END IF;
  IF NOT current_profile_has_capability('finance.workspace.access') OR NOT current_profile_has_capability('stripe.inspect') OR NOT current_profile_has_capability('deposit.capture') THEN RAISE EXCEPTION 'Finance capability missing.'; END IF;
  IF current_profile_has_capability('operations.workspace.access') OR current_profile_has_capability('trips.start') OR current_profile_has_capability('owner.assign_platform_roles') THEN RAISE EXCEPTION 'Finance leaked Operations/Owner authority.'; END IF;
  IF (SELECT can_admin FROM get_my_account_capabilities()) THEN RAISE EXCEPTION 'Finance assignment exposed Admin mode.'; END IF;

  PERFORM set_config('role','service_role',true);
  SELECT count(*) INTO audit_count FROM public.platform_role_assignment_audit WHERE profile_id=ordinary_profile;
  IF audit_count<>3 THEN RAISE EXCEPTION 'Expected assignment/revoke/assignment audit, got %.',audit_count; END IF;
  BEGIN UPDATE public.platform_role_assignment_audit SET reason='Tampered' WHERE profile_id=ordinary_profile; RAISE EXCEPTION 'Audit update allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='Audit update allowed.' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.platform_role_assignment_audit WHERE profile_id=ordinary_profile; RAISE EXCEPTION 'Audit delete allowed.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='Audit delete allowed.' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS: Owner root, zero assignments, capability isolation, spoof rejection, idempotency and immutable audit';
END $test$;