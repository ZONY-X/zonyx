CREATE OR REPLACE FUNCTION public.validate_additional_drivers_in_accepted_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE item jsonb; expected_names text[]; snapshot_names text[];
BEGIN
 IF NEW.accepted_at IS NULL OR OLD.accepted_at IS NOT NULL OR NEW.master_version NOT IN ('1.4','1.5') THEN RETURN NEW; END IF;
 IF NOT(NEW.trip_financial_summary ? 'primary_authorized_driver') OR NOT(NEW.trip_financial_summary ? 'additional_authorized_drivers') THEN RAISE EXCEPTION 'Rental Agreement driver snapshot is incomplete.'; END IF;
 IF position('Additional Authorized Driver(s): ' in NEW.rendered_text)=0 THEN RAISE EXCEPTION 'Additional Authorized Driver section is missing from the executed agreement snapshot.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.trip_financial_summary->'additional_authorized_drivers','[]')) LOOP
  IF NULLIF(btrim(item->>'legal_name'),'') IS NULL OR position(item->>'legal_name' in NEW.rendered_text)=0 THEN RAISE EXCEPTION 'Additional Authorized Driver is missing from the executed agreement snapshot.'; END IF;
 END LOOP;
 IF NEW.reservation_context_id IS NOT NULL THEN
  SELECT COALESCE(array_agg(d.full_legal_name ORDER BY d.approved_at,d.id),'{}') INTO expected_names FROM public.reservation_additional_authorized_drivers d WHERE d.reservation_context_id=NEW.reservation_context_id AND d.approval_status='approved';
  SELECT COALESCE(array_agg(x->>'legal_name' ORDER BY x->>'approved_at',x->>'record_id'),'{}') INTO snapshot_names FROM jsonb_array_elements(COALESCE(NEW.trip_financial_summary->'additional_authorized_drivers','[]')) x;
  IF expected_names<>snapshot_names THEN RAISE EXCEPTION 'Trusted Additional Authorized Drivers changed after agreement preparation.'; END IF;
 END IF;
 RETURN NEW;
END $function$
;
