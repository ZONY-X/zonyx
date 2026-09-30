-- Run after 20261001120000. The validation runner supplies BEGIN/ROLLBACK.
DO $correction_test$
DECLARE agreement_row public.booking_rental_agreements%ROWTYPE; correction_row public.booking_rental_agreement_corrections%ROWTYPE; admin_user uuid; guest_user uuid; admin_payload jsonb; guest_payload jsonb; original_fingerprint text;
BEGIN
 SELECT agreement.* INTO agreement_row FROM public.booking_rental_agreements agreement JOIN public.bookings booking ON booking.id=agreement.booking_id WHERE booking.reservation_number='ZNX-000150' AND agreement.accepted_at IS NOT NULL;
 SELECT * INTO correction_row FROM public.booking_rental_agreement_corrections WHERE agreement_id=agreement_row.id;
 IF correction_row.id IS NULL THEN RAISE EXCEPTION 'ZNX-000150 correction was not created.'; END IF;
 IF correction_row.original_document_hash<>agreement_row.document_hash OR encode(extensions.digest(correction_row.corrected_rendered_text,'sha256'),'hex')<>correction_row.corrected_document_hash THEN RAISE EXCEPTION 'Correction hash evidence is invalid.'; END IF;
 IF position('Additional Authorized Driver: Alejandra Ponce Gutierrez' in correction_row.corrected_rendered_text)=0 OR position('Additional Authorized Driver: Alejandra Ponce Gutierrez' in agreement_row.rendered_text)>0 THEN RAISE EXCEPTION 'Correction text or original preservation failed.'; END IF;
 IF correction_row.reason<>'Correction of omitted Additional Authorized Driver.' OR correction_row.customer_reaccepted THEN RAISE EXCEPTION 'Correction reason/reacceptance evidence is invalid.'; END IF;
 original_fingerprint:=md5(agreement_row.id::text||':'||agreement_row.booking_id::text||':'||agreement_row.accepted_at::text||':'||agreement_row.accepted_ip::text||':'||agreement_row.accepted_user_agent||':'||agreement_row.document_hash||':'||md5(agreement_row.rendered_text));
 SELECT p.user_id INTO admin_user FROM public.profiles p WHERE p.is_admin ORDER BY p.created_at LIMIT 1; guest_user:=agreement_row.guest_auth_user_id;
 PERFORM set_config('request.jwt.claim.sub',admin_user::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated; admin_payload:=public.get_booking_rental_agreement(agreement_row.booking_id); RESET ROLE;
 IF admin_payload->>'rendered_text'<>correction_row.corrected_rendered_text OR admin_payload->>'document_hash'<>correction_row.corrected_document_hash OR admin_payload#>>'{correction,original_document_hash}'<>agreement_row.document_hash THEN RAISE EXCEPTION 'Admin corrected retrieval failed.'; END IF;
 IF admin_payload#>>'{trip_financial_summary,administrative_correction_additional_authorized_drivers,0,legal_name}'<>'Alejandra Ponce Gutierrez' THEN RAISE EXCEPTION 'Corrected structured driver evidence is missing.'; END IF;
 IF encode(extensions.digest(admin_payload->>'rendered_text','sha256'),'hex')<>admin_payload->>'document_hash' THEN RAISE EXCEPTION 'Downloaded corrected representation hash failed.'; END IF;
 PERFORM set_config('request.jwt.claim.sub',guest_user::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); SET LOCAL ROLE authenticated; guest_payload:=public.get_booking_rental_agreement(agreement_row.booking_id); RESET ROLE;
 IF guest_payload->>'rendered_text'<>agreement_row.rendered_text OR guest_payload->>'document_hash'<>agreement_row.document_hash OR guest_payload->'correction'<>'null'::jsonb THEN RAISE EXCEPTION 'Original Guest-accepted representation changed.'; END IF;
 IF original_fingerprint<>md5(agreement_row.id::text||':'||agreement_row.booking_id::text||':'||agreement_row.accepted_at::text||':'||agreement_row.accepted_ip::text||':'||agreement_row.accepted_user_agent||':'||agreement_row.document_hash||':'||md5(agreement_row.rendered_text)) THEN RAISE EXCEPTION 'Original acceptance evidence changed.'; END IF;
 BEGIN UPDATE public.booking_rental_agreement_corrections SET reason='Illegal mutation' WHERE id=correction_row.id; RAISE EXCEPTION 'Correction mutation succeeded.'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Correction mutation succeeded.' THEN RAISE; END IF; END;
END $correction_test$;

DO $single_driver_trigger_test$
DECLARE guest uuid; guest_user uuid; vehicle uuid; master uuid; context uuid:='10112000-0000-4000-8000-000000000021'; agreement uuid:='10112000-0000-4000-8000-000000000025'; summary jsonb; rendered text;
BEGIN
 SELECT p.id,p.user_id INTO guest,guest_user FROM public.profiles p JOIN public.driver_eligibility d ON d.profile_id=p.id WHERE NOT p.is_admin ORDER BY p.created_at LIMIT 1;
 SELECT id INTO vehicle FROM public.vehicles ORDER BY created_at LIMIT 1; SELECT id INTO master FROM public.rental_agreement_versions WHERE version='1.4';
 INSERT INTO public.reservation_agreement_contexts(id,proposed_booking_id,guest_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,reservation_fingerprint,status,administrative_source,created_by_profile_id)
 VALUES(context,'10112000-0000-4000-8000-000000000022',guest,vehicle,'2044-02-01','2044-02-02','10:00','10:00','Miami Beach','Brickell',repeat('c',64),'prepared','test',(SELECT id FROM public.profiles WHERE is_admin LIMIT 1));
 INSERT INTO public.reservation_additional_authorized_drivers(id,reservation_context_id,full_legal_name,approval_status,approved_at,approved_by_profile_id,administrative_source)
 VALUES('10112000-0000-4000-8000-000000000023',context,'Alejandra Ponce Gutierrez','approved','2043-12-01',(SELECT id FROM public.profiles WHERE is_admin LIMIT 1),'test');
 summary:=jsonb_build_object('primary_authorized_driver',jsonb_build_object('profile_id',guest,'legal_name','Primary Driver','role','primary'),'additional_authorized_drivers',jsonb_build_array(jsonb_build_object('record_id','10112000-0000-4000-8000-000000000023','legal_name','Alejandra Ponce Gutierrez','role','additional','approved_at','2043-12-01')));
 rendered:='Primary Authorized Driver: Primary Driver'||chr(10)||'Additional Authorized Driver(s): Alejandra Ponce Gutierrez';
 INSERT INTO public.booking_rental_agreements(id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at,reservation_context_id)
 VALUES(agreement,'10112000-0000-4000-8000-000000000022',master,'1.4',guest,guest_user,summary,rendered,encode(extensions.digest(rendered,'sha256'),'hex'),'single-driver-integrity',now()+interval '1 hour',context);
 UPDATE public.reservation_agreement_contexts SET prepared_agreement_id=agreement WHERE id=context;
 BEGIN UPDATE public.booking_rental_agreements SET accepted_at=now(),booking_id=proposed_booking_id WHERE id=agreement; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $single_driver_trigger_test$;

DO $driver_trigger_test$
DECLARE guest uuid; guest_user uuid; host uuid; vehicle uuid; master uuid; context uuid; agreement uuid; summary jsonb; rendered text;
BEGIN
 SELECT p.id,p.user_id INTO guest,guest_user FROM public.profiles p JOIN public.driver_eligibility d ON d.profile_id=p.id WHERE NOT p.is_admin ORDER BY p.created_at LIMIT 1;
 SELECT v.host_profile_id,v.id INTO host,vehicle FROM public.vehicles v ORDER BY v.created_at LIMIT 1; SELECT id INTO master FROM public.rental_agreement_versions WHERE version='1.4';
 INSERT INTO public.reservation_agreement_contexts(id,proposed_booking_id,guest_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,reservation_fingerprint,status,administrative_source,created_by_profile_id)
 VALUES('10112000-0000-4000-8000-000000000001','10112000-0000-4000-8000-000000000002',guest,vehicle,'2044-01-01','2044-01-02','10:00','10:00','Miami Beach','Brickell',repeat('a',64),'prepared','test',(SELECT id FROM public.profiles WHERE is_admin LIMIT 1)) RETURNING id INTO context;
 INSERT INTO public.reservation_additional_authorized_drivers(id,reservation_context_id,full_legal_name,approval_status,approved_at,approved_by_profile_id,administrative_source) VALUES
 ('10112000-0000-4000-8000-000000000003',context,'Alejandra Ponce Gutierrez','approved','2043-12-01',(SELECT id FROM public.profiles WHERE is_admin LIMIT 1),'test'),
 ('10112000-0000-4000-8000-000000000004',context,'Second Additional Driver','approved','2043-12-02',(SELECT id FROM public.profiles WHERE is_admin LIMIT 1),'test');
 summary:=jsonb_build_object('primary_authorized_driver',jsonb_build_object('profile_id',guest,'legal_name','Primary Driver','role','primary'),'additional_authorized_drivers',jsonb_build_array(jsonb_build_object('record_id','10112000-0000-4000-8000-000000000003','legal_name','Alejandra Ponce Gutierrez','role','additional','approved_at','2043-12-01'),jsonb_build_object('record_id','10112000-0000-4000-8000-000000000004','legal_name','Second Additional Driver','role','additional','approved_at','2043-12-02')));
 rendered:='Primary Authorized Driver: Primary Driver'||chr(10)||'Additional Authorized Driver(s): Alejandra Ponce Gutierrez, Second Additional Driver';
 agreement:='10112000-0000-4000-8000-000000000005';
 INSERT INTO public.booking_rental_agreements(id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at,reservation_context_id)
 VALUES(agreement,'10112000-0000-4000-8000-000000000002',master,'1.4',guest,guest_user,summary,rendered,encode(extensions.digest(rendered,'sha256'),'hex'),'driver-integrity-test',now()+interval '1 hour',context);
 UPDATE public.reservation_agreement_contexts SET prepared_agreement_id=agreement WHERE id=context;
 -- The trigger runs before FK validation; matching one/multiple names must pass driver-integrity validation.
 BEGIN UPDATE public.booking_rental_agreements SET accepted_at=now(),booking_id=proposed_booking_id WHERE id=agreement; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 UPDATE public.booking_rental_agreements SET rendered_text='Primary Authorized Driver: Primary Driver'||chr(10)||'Additional Authorized Driver(s): Alejandra Ponce Gutierrez',document_hash=repeat('b',64) WHERE id=agreement;
 BEGIN UPDATE public.booking_rental_agreements SET accepted_at=now(),booking_id=proposed_booking_id WHERE id=agreement; RAISE EXCEPTION 'Missing second driver accepted.'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Missing second driver accepted.' THEN RAISE; END IF; END;
END $driver_trigger_test$;
SELECT 'PASS: immutable correction and Additional Authorized Driver acceptance integrity' AS result;