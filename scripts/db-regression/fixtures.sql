-- Entirely synthetic identities and accepted evidence, seeded before revision
-- bootstrap. Existing test literals are labels, never production row copies.
INSERT INTO public.driver_eligibility(profile_id,legal_name,date_of_birth,license_issuing_country,license_issuing_region,license_expiration_date,self_attested_at)
SELECT id,'Synthetic Primary Driver','1990-01-01','US','FL','2099-01-01',now()
FROM public.profiles WHERE NOT is_admin;

DO $fixtures$
DECLARE guest public.profiles%ROWTYPE; actor uuid; vehicle public.vehicles%ROWTYPE;
 b uuid; a uuid; doc text; corrected text; n integer; version_id uuid;
BEGIN
 SELECT * INTO guest FROM public.profiles WHERE NOT is_admin ORDER BY created_at LIMIT 1;
 SELECT id INTO actor FROM public.profiles WHERE is_admin ORDER BY created_at LIMIT 1;
 SELECT * INTO vehicle FROM public.vehicles ORDER BY created_at LIMIT 1;
 SELECT id INTO version_id FROM public.rental_agreement_versions WHERE version='1.3';
 FOR n IN 1..2 LOOP
  b:=gen_random_uuid(); a:=gen_random_uuid();
  doc:=CASE WHEN n=1 THEN 'Synthetic executed Rental Agreement' ELSE 'Authorized Driver(s): Federico Flores Navarro' END;
  INSERT INTO public.bookings(id,reservation_number,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,terms_accepted_at,rental_agreement_accepted_at)
  VALUES(b,CASE WHEN n=1 THEN 'SYNTHETIC-ACCEPTED' ELSE 'ZNX-000150' END,guest.id,vehicle.host_profile_id,vehicle.id,'2026-09-21','2026-10-21','11:30','11:30','Miami International Airport','Coconut Grove','pickup',CASE WHEN n=1 THEN 'completed' ELSE 'active' END,10000,1200,896,12096,'usd',now(),now());
  INSERT INTO public.booking_rental_agreements(id,booking_id,proposed_booking_id,master_agreement_id,master_version,guest_profile_id,guest_auth_user_id,accepted_at,accepted_ip,accepted_user_agent,trip_financial_summary,rendered_text,document_hash,idempotency_key,preparation_expires_at)
  VALUES(a,b,b,version_id,'1.3',guest.id,guest.user_id,'2026-09-21'::timestamptz+n*interval '1 minute','127.0.0.1','isolated-synthetic-fixture',
   jsonb_build_object('vehicle_id',vehicle.id,'start_date','2026-09-21','end_date','2026-10-21','pickup_time','11:30','dropoff_time','11:30','pickup_location','Miami International Airport','dropoff_location','Coconut Grove','fulfillment_method','pickup','primary_authorized_driver',jsonb_build_object('legal_name','Federico Flores Navarro','role','primary'),'additional_authorized_drivers','[]'::jsonb,'final_total_cents',12096,'currency','usd'),
   doc,encode(extensions.digest(doc,'sha256'),'hex'),'synthetic-accepted-'||n,now()+interval '1 hour');
  IF n=2 THEN
   corrected:=doc||chr(10)||'Additional Authorized Driver: Alejandra Ponce Gutierrez';
   INSERT INTO public.booking_rental_agreement_corrections(agreement_id,booking_id,original_document_hash,corrected_document_hash,corrected_rendered_text,correction_type,exact_correction,reason,actor_profile_id,actor_type)
   VALUES(a,b,encode(extensions.digest(doc,'sha256'),'hex'),encode(extensions.digest(corrected,'sha256'),'hex'),corrected,'additional_authorized_driver_omission','Added Additional Authorized Driver: Alejandra Ponce Gutierrez','Correction of omitted Additional Authorized Driver.',actor,'system_on_behalf_of_admin');
  END IF;
 END LOOP;
END $fixtures$;
