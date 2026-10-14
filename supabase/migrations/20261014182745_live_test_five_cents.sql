-- Five-cent LIVE test only. Preserve renewal minimums and historical payments.
ALTER TABLE public.square_live_test_checkouts DROP CONSTRAINT square_live_test_checkouts_amount_cents_check;
ALTER TABLE public.square_live_test_checkouts ADD CONSTRAINT square_live_test_checkouts_amount_cents_check CHECK(amount_cents IN(5,100));
ALTER TABLE public.square_live_test_checkouts ALTER COLUMN amount_cents SET DEFAULT 5;
ALTER TABLE public.square_live_test_checkouts ALTER COLUMN description SET DEFAULT 'ZONYX PAY - LIVE $0.05 payment test';
ALTER TABLE public.square_renewal_payment_attempts DROP CONSTRAINT square_renewal_payment_attempts_amount_cents_check;
ALTER TABLE public.square_renewal_payment_attempts ADD CONSTRAINT square_renewal_payment_attempts_amount_cents_check CHECK((test_id IS NULL AND amount_cents>=50) OR (test_id IS NOT NULL AND amount_cents IN(5,100)));
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.prepare_square_cof_checkout(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text)'::regprocedure) INTO definition;
 definition:=replace(definition,$old$VALUES(t.id,n,100,'usd','live',_location_id)$old$,$new$VALUES(t.id,n,t.amount_cents,'usd','live',_location_id)$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef('public.record_square_checkout_payment(uuid,text,bigint,text,text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'_amount_cents<>100','_amount_cents<>t.amount_cents');
 EXECUTE definition;
END $$;
