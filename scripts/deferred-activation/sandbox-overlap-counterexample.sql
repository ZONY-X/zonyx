-- SANDBOX ONLY: requires the isolated synthetic sandbox_provider_fixture.
-- Diagnostic counterexample, not a passing safety test. Always rolls back.
BEGIN;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE overlap_observation (paypal_capture_allowed boolean,stripe_state text);
DO $t$
DECLARE f public.sandbox_provider_fixture%ROWTYPE; b public.bookings%ROWTYPE; a public.booking_rental_agreements%ROWTYPE; b2 uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); sp public.booking_payments%ROWTYPE; pp jsonb;
BEGIN
SELECT * INTO f FROM public.sandbox_provider_fixture LIMIT 1;
SELECT * INTO b FROM public.bookings WHERE id=f.booking_id;
SELECT * INTO a FROM public.booking_rental_agreements WHERE id=f.agreement_id;
INSERT INTO public.bookings(id,renter_profile_id,host_profile_id,vehicle_id,start_date,end_date,pickup_time,dropoff_time,pickup_location,dropoff_location,fulfillment_method,trip_status,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,terms_accepted_at,rental_agreement_accepted_at)
VALUES(b2,b.renter_profile_id,b.host_profile_id,b.vehicle_id,b.start_date,b.end_date,b.pickup_time,b.dropoff_time,b.pickup_location,b.dropoff_location,b.fulfillment_method,'pending_payment',b.subtotal_cents,b.service_fee_cents,b.taxes_cents,b.grand_total_cents,b.currency,now(),now());
INSERT INTO public.booking_rental_agreements SELECT (jsonb_populate_record(NULL::public.booking_rental_agreements,to_jsonb(a)||jsonb_build_object('id',a2,'booking_id',b2,'proposed_booking_id',b2,'idempotency_key','overlap-'||a2::text))).*;
sp:=public.reserve_rental_payment_provider(b.id,a.id,'stripe',f.user_id,'sandbox');
UPDATE public.booking_payments SET state='paid',capture_id='synthetic-stripe-paid' WHERE id=sp.id;
pp:=public.prepare_paypal_expanded_payment(b2,a2,f.user_id,'sandbox','card');
PERFORM public.attach_paypal_rental_order((pp#>>'{payment,id}')::uuid,'synthetic-overlap-order',NULL);
PERFORM public.claim_paypal_rental_capture((pp#>>'{payment,id}')::uuid,f.user_id);
INSERT INTO overlap_observation VALUES(true,'paid');
END $t$;
SELECT * FROM overlap_observation;
ROLLBACK;
