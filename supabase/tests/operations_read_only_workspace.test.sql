DO $test$
DECLARE
  owner_profile uuid; owner_user uuid; operations_profile uuid; operations_user uuid; finance_profile uuid; finance_user uuid;
  assignment uuid; payload jsonb; receipt_booking uuid; before_assignments integer;
BEGIN
  SELECT count(*) INTO before_assignments FROM public.profile_platform_roles WHERE revoked_at IS NULL;
  IF before_assignments<>0 THEN RAISE EXCEPTION 'Expected no production staff assignments for Phase 2 test.'; END IF;
  SELECT p.id,p.user_id INTO owner_profile,owner_user FROM public.profiles p JOIN auth.users u ON u.id=p.user_id WHERE lower(p.email)='zoeysnp@gmail.com' AND lower(u.email)='zoeysnp@gmail.com' AND p.is_admin LIMIT 1;
  SELECT id,user_id INTO operations_profile,operations_user FROM public.profiles WHERE id<>owner_profile ORDER BY created_at LIMIT 1;
  SELECT id,user_id INTO finance_profile,finance_user FROM public.profiles WHERE id NOT IN(owner_profile,operations_profile) ORDER BY created_at LIMIT 1;
  IF finance_profile IS NULL THEN RAISE EXCEPTION 'Insufficient profile fixtures.'; END IF;

  PERFORM set_config('role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',operations_user::text,true);
  IF public.current_profile_has_capability('operations.workspace.access') THEN RAISE EXCEPTION 'Ordinary account received Operations capability.'; END IF;
  BEGIN PERFORM public.get_operations_bookings(); RAISE EXCEPTION 'Guest invoked Operations bookings.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest invoked%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_operations_vehicles(); RAISE EXCEPTION 'Guest invoked Operations vehicles.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest invoked%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_operations_accounts(); RAISE EXCEPTION 'Guest invoked Operations accounts.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest invoked%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_operations_after_trip_queue(); RAISE EXCEPTION 'Guest invoked Operations after-trip.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Guest invoked%' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claim.sub',owner_user::text,true);
  assignment:=public.owner_assign_platform_role(operations_profile,'operations','Synthetic Operations workspace test');
  PERFORM public.owner_assign_platform_role(finance_profile,'finance','Synthetic Finance isolation test');
  IF NOT public.current_profile_is_admin() OR NOT public.current_profile_has_capability('operations.workspace.access') THEN RAISE EXCEPTION 'Owner compatibility failed.'; END IF;
  PERFORM public.get_operations_bookings();

  PERFORM set_config('request.jwt.claim.sub',finance_user::text,true);
  IF public.current_profile_has_capability('operations.workspace.access') THEN RAISE EXCEPTION 'Finance inherited Operations workspace.'; END IF;
  BEGIN PERFORM public.get_operations_bookings(); RAISE EXCEPTION 'Finance invoked Operations bookings.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Finance invoked%' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claim.sub',operations_user::text,true);
  IF NOT public.current_profile_has_capability('operations.workspace.access') THEN RAISE EXCEPTION 'Operations workspace capability missing.'; END IF;
  IF public.current_profile_is_admin() OR public.current_profile_has_capability('finance.workspace.access') OR public.current_profile_has_capability('stripe.inspect') OR public.current_profile_has_capability('deposit.capture') OR public.current_profile_has_capability('refund.execute') OR public.current_profile_has_capability('after_trip.allocate_settlement') OR public.current_profile_has_capability('promo.manage') OR public.current_profile_has_capability('owner.assign_platform_roles') THEN RAISE EXCEPTION 'Operations capability isolation failed.'; END IF;

  payload:=public.get_operations_bookings();
  IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload)=0 THEN RAISE EXCEPTION 'Operations bookings projection unavailable.'; END IF;
  IF payload::text ~* 'stripe|payment_intent|checkout_session|external_reference|ledger|reconciliation|audit|date_of_birth|license|legal_name' THEN RAISE EXCEPTION 'Sensitive field leaked in Operations bookings.'; END IF;
  payload:=public.get_operations_vehicles();
  IF jsonb_typeof(payload)<>'array' OR payload::text ~* 'vin|plate|base_daily_rate|stripe|ledger' THEN RAISE EXCEPTION 'Sensitive/financial vehicle field leaked.'; END IF;
  payload:=public.get_operations_accounts();
  IF jsonb_typeof(payload)<>'array' OR payload::text ~* 'is_admin|date_of_birth|license|legal_name|phone|avatar|user_id|stripe' THEN RAISE EXCEPTION 'Private account field leaked.'; END IF;
  payload:=public.get_operations_after_trip_queue();
  IF jsonb_typeof(payload)<>'array' OR payload::text ~* 'source_ledger|external_reference|payment_intent|stripe|reconciliation|audit' THEN RAISE EXCEPTION 'Raw financial evidence leaked in Operations after-trip queue.'; END IF;

  SELECT booking_id INTO receipt_booking FROM public.booking_financial_reconciliations ORDER BY created_at LIMIT 1;
  IF receipt_booking IS NOT NULL THEN
    payload:=public.get_operations_trip_receipt(receipt_booking);
    IF payload->>'read_only'<>'true' OR payload::text ~* 'source_ledger|external_reference|payment_intent|stripe|reconciliation|audit|date_of_birth|license|legal_name' THEN RAISE EXCEPTION 'Operations receipt leaked privileged data.'; END IF;
  END IF;

  BEGIN PERFORM public.owner_assign_platform_role(operations_profile,'operations','Spoof Owner role assignment'); RAISE EXCEPTION 'Operations assigned a platform role.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Operations assigned%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.admin_correct_historical_trip_details(receipt_booking,CURRENT_DATE,'10:00',CURRENT_DATE+1,'10:00','A','B','pickup','Unauthorized correction'); RAISE EXCEPTION 'Operations used Admin correction.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Operations used%' THEN RAISE; END IF; END;

  PERFORM set_config('request.jwt.claim.sub',owner_user::text,true);
  PERFORM public.owner_revoke_platform_role(operations_profile,'operations','Synthetic Operations access revocation');
  PERFORM set_config('request.jwt.claim.sub',operations_user::text,true);
  IF public.current_profile_has_capability('operations.workspace.access') THEN RAISE EXCEPTION 'Revoked Operations access remained active.'; END IF;
  BEGIN PERFORM public.get_operations_bookings(); RAISE EXCEPTION 'Revoked user invoked Operations projection.'; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Revoked user%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS: Operations read-only workspace capability, isolation, payload allowlists, Owner compatibility, receipt and revocation tests';
END $test$;