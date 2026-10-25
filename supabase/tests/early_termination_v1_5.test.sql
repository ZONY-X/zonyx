SELECT no_plan();
SELECT is((SELECT version FROM rental_agreement_versions WHERE id='6deae437-4b73-43a0-b60e-0894ce7d57f1'),'1.5','v1.5 master published');
SELECT ok((SELECT canonical_body LIKE '%For reservations of 60 days or longer%' AND canonical_body LIKE '%one and one-half (1.5) months%' AND canonical_body LIKE '%whichever is lower%' AND canonical_body LIKE '%replacement rental revenue%' FROM rental_agreement_versions WHERE version='1.5'),'duration, multiplier, damages cap and mitigation included');
SELECT is((SELECT content_hash FROM rental_agreement_versions WHERE version='1.4'),'2d941427e7d1c27cd744d3785a2bca40f2200e327e0963e5d5558ab95fec9be3','historical master unchanged');
SELECT ok((SELECT prosrc LIKE '%master_version <> ''1.6''%' FROM pg_proc WHERE oid='public.accept_prepared_rental_agreement(uuid,text,boolean,boolean,uuid,inet,text)'::regprocedure),'existing unsigned acceptance validates current version');
SELECT ok((SELECT prosrc LIKE '%b71d882a-4775-47b5-9be5-61b205a01506%' FROM pg_proc WHERE oid='public.prepare_square_cof_checkout(text,text,uuid,jsonb,text,text,jsonb,boolean,boolean,text)'::regprocedure),'existing renewal acceptance validates current version');
SELECT ok((SELECT prosrc LIKE '%NEW.master_version NOT IN (''1.4'',''1.5'',''1.6'')%' FROM pg_proc WHERE oid='public.validate_additional_drivers_in_accepted_snapshot()'::regprocedure),'existing driver validation applies to v1.5');
SELECT ok(to_regclass('public.payment_rental_addendum_acceptances') IS NULL,'unrequested addendum feature removed');
