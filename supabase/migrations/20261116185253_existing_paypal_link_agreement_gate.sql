-- Agreement evidence only. No payment, booking or provider order is created.
create table public.existing_paypal_link_contexts (
 payment_id uuid primary key,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 snapshot jsonb not null,
 agreement_hash text not null check(agreement_hash ~ '^[a-f0-9]{64}$'),
 destination text not null check(destination='https://www.paypal.com/ncp/payment/DZY2WXFF5XS8L'),
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 check(payment_id='835e0865-7701-4b9d-86bc-6d617c2d9bc0'::uuid),
 check((snapshot->>'amountCents')::integer=375000 and snapshot->>'currency'='USD'),
 check(snapshot->'agreement'->>'hash'=agreement_hash)
);
create table public.existing_paypal_link_acceptances (
 id uuid primary key,
 payment_id uuid not null references public.existing_paypal_link_contexts(payment_id),
 agreement_hash text not null,
 payer_name text not null,
 payer_email text not null,
 postal_code text not null,
 acceptance_wording text not null,
 user_agent text not null,
 accepted_at timestamptz not null default now()
);
alter table public.existing_paypal_link_contexts enable row level security;
alter table public.existing_paypal_link_acceptances enable row level security;
revoke all on public.existing_paypal_link_contexts,public.existing_paypal_link_acceptances from public,anon,authenticated;
grant select,insert on public.existing_paypal_link_contexts,public.existing_paypal_link_acceptances to service_role;
create function public.accept_existing_paypal_link(_payment_id uuid,_submission_id uuid,_agreement_hash text,_payer_name text,_payer_email text,_postal_code text,_wording text,_user_agent text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c existing_paypal_link_contexts; a existing_paypal_link_acceptances;
begin
 select * into strict c from existing_paypal_link_contexts where payment_id=_payment_id and enabled;
 if _agreement_hash is distinct from c.agreement_hash or length(trim(_payer_name))<2 or length(_payer_name)>160 or _payer_name is null
  or _payer_email is null or length(_payer_email)>254 or _payer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or _postal_code is null or length(trim(_postal_code))<2 or length(_postal_code)>16
  or _wording is distinct from 'I am the cardholder or authorized user and authorize future charges under these Terms and accept the Rental Agreement.'
  then raise exception 'Rental Agreement acceptance required'; end if;
 insert into existing_paypal_link_acceptances(id,payment_id,agreement_hash,payer_name,payer_email,postal_code,acceptance_wording,user_agent)
  values(_submission_id,_payment_id,_agreement_hash,_payer_name,_payer_email,_postal_code,_wording,left(coalesce(_user_agent,''),500)) on conflict(id) do nothing;
 select * into strict a from existing_paypal_link_acceptances where id=_submission_id;
 if a.payment_id<>_payment_id or a.agreement_hash<>_agreement_hash or a.payer_name<>_payer_name or a.payer_email<>_payer_email or a.postal_code<>_postal_code then raise exception 'Acceptance identity mismatch'; end if;
 return jsonb_build_object('id',a.id,'accepted_at',a.accepted_at);
end $$;
revoke all on function public.accept_existing_paypal_link(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.accept_existing_paypal_link(uuid,uuid,text,text,text,text,text,text) to service_role;
