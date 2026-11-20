create function public.claim_herman_deposit_paypal_create(_id uuid, _agreement_hash text, _payer_name text, _payer_email text)
returns jsonb language plpgsql set search_path=public as $$
declare p public.standalone_paypal_links; q public.standalone_upgrade_quotes;
begin
 select * into strict p from public.standalone_paypal_links where id=_id for update;
 select * into strict q from public.standalone_upgrade_quotes where id=p.quote_id;
 if q.reservation_number<>'ZNX-000221' or q.quote->>'kind'<>'security_deposit' or p.amount_cents<>75000 or p.currency<>'USD' or p.environment<>'live' or p.provider<>'paypal' or p.review_only or not p.enabled then raise exception 'Deposit payment unavailable'; end if;
 if p.state<>'ready' then return jsonb_build_object('dispatch',false,'payment',to_jsonb(p)); end if;
 if _agreement_hash is distinct from q.agreement_hash or length(trim(_payer_name))<2 or length(_payer_name)>160 or length(_payer_email)>254 or _payer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Payment consent and cardholder details required'; end if;
 update public.standalone_paypal_links set state='creating',agreement_accepted_hash=_agreement_hash,payer_name=trim(_payer_name),payer_email=lower(trim(_payer_email)),accepted_at=now() where id=_id returning * into p;
 return jsonb_build_object('dispatch',true,'payment',to_jsonb(p));
end $$;
revoke all on function public.claim_herman_deposit_paypal_create(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_herman_deposit_paypal_create(uuid,text,text,text) to service_role;
