import { supabase } from '@/integrations/supabase/client';
export type Tier={name:string;rate_bps:number;completed_threshold:number};
export type Program={tiers:Tier[];thresholds_active:boolean;reconciliation_days:number};
export type Partner={id:string;contact_name:string;business_name:string;business_type:string;email:string;phone:string;website:string|null;status:string;referral_code:string|null;created_at:string};
export type Referral={booking_id:string;partner_id:string;reservation:string;start_date:string;end_date:string;trip_status:string;currency:string;tier:string|null;rate_bps:number|null;eligible_net_cents:number;commission_cents:number;balance_cents:number;paid_cents:number;state:string;payable_at:string|null};
export type Ledger={id:string;booking_id:string;event_type:string;amount_cents:number;currency:string;reason:string;external_reference:string;created_at:string};
export async function partnerRpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
 const rpc=supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>;
 const {data,error}=await rpc(name,args);if(error)throw new Error(error.message);return data as T;
}
export const partnerMoney=(cents:number,currency='usd')=>new Intl.NumberFormat('en-US',{style:'currency',currency:currency.toUpperCase()}).format(cents/100);
export type Attribution={code:string;at:number;source:'link'|'code'};
const key='zonyx-partner-referral-v1';
export function getPartnerReferral():Attribution|null{
 try{const value=JSON.parse(localStorage.getItem(key)||'null') as Attribution|null;if(value&&/^[A-Z0-9]{4,24}$/.test(value.code)&&value.at>Date.now()-30*86400000&&value.at<=Date.now())return value;localStorage.removeItem(key);}catch{/* Storage can be unavailable in private browsing. */}return null;
}
export async function rememberPartner(code:string,source:'link'|'code'){
 const normalized=code.trim().toUpperCase();if(!/^[A-Z0-9]{4,24}$/.test(normalized))throw new Error('Enter an active ZONYX partner code.');
 const valid=await partnerRpc<{valid:boolean}>('validate_partner_code',{_code:normalized});if(!valid.valid)throw new Error('This partner code is not active.');
 const existing=getPartnerReferral();if(existing&&existing.code!==normalized)throw new Error('An existing partner referral is already attached to this visit.');
 try{if(!existing)localStorage.setItem(key,JSON.stringify({code:normalized,at:Date.now(),source}));}catch{throw new Error('Enable website storage to keep this referral through checkout.');}
}
export async function attachPartnerToBooking(bookingId:string){const ref=getPartnerReferral();if(ref)await partnerRpc('attach_partner_referral',{_booking_id:bookingId,_code:ref.code,_source:ref.source});}
