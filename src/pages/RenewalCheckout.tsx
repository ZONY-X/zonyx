import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { ZonyxPayBrand } from '@/components/rental/ZonyxPayBrand';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

type Details = { period_id: string; reservation_number: string; period_start: string; period_end: string; amount_cents: number; currency: string; payment_status: string; paid_at: string | null; plan_status: string; can_pay: boolean; preview?: boolean; admin_inspection?: boolean; checkout_state?: string | null; provider: string; environment: string; applicationId: string; locationId: string };
type Card = { attach(element: HTMLElement): Promise<void>; destroy(): Promise<void>; tokenize(details: Record<string, unknown>): Promise<{status: string; token?: string}> };
type SquareSDK = {payments(app: string,location: string): {card(options?: {style: Record<string,unknown>}): Promise<Card>}};
const macSafari=typeof navigator!=='undefined'&&/Macintosh/.test(navigator.userAgent)&&/Version\/[\d.]+.*Safari\//.test(navigator.userAgent);
let sdkPromise:Promise<SquareSDK>|undefined;
function loadSquare(){
 return sdkPromise??=new Promise<SquareSDK>((resolve,reject)=>{
  const existing=(window as Window & {Square?:SquareSDK}).Square;if(existing){resolve(existing);return;}
  const script=document.createElement('script');script.src='https://web.squarecdn.com/v1/square.js';
  script.onload=()=>{const sdk=(window as Window & {Square?:SquareSDK}).Square;if(sdk)resolve(sdk);else{sdkPromise=undefined;reject(new Error('Square card form unavailable.'));}};
  script.onerror=()=>{sdkPromise=undefined;script.remove();reject(new Error('Square card form could not load.'));};document.head.appendChild(script);
 });
}
async function renewalRequest(payload: Record<string, unknown>) {
 const { data, error } = await supabase.functions.invoke('renewal-checkout', { body: payload });
 if (error) { let message = error.message; const response = (error as { context?: Response }).context; if (response instanceof Response) { try { message = (await response.json()).error || message; } catch { /* Keep network error. */ } } throw new Error(message); }
 if (data?.error) throw new Error(data.error);
 return data as Details;
}
export default function RenewalCheckout() {
 const [params] = useSearchParams(); const { user, loading } = useAuth();
 const periodId=params.get('periodId')||'',previewToken=params.get('preview')||'';
 const [working,setWorking]=useState(false),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[attempted,setAttempted]=useState(false);
 const host=useRef<HTMLDivElement>(null),card=useRef<Card>(),lock=useRef(false);
 const {data,error,isLoading,refetch}=useQuery({queryKey:['guest-renewal',periodId,previewToken,user?.id],queryFn:()=>renewalRequest(previewToken?{action:'details',previewToken}:{action:'details',periodId}),enabled:Boolean(previewToken||periodId&&user),retry:false});
 const paid=data?.payment_status==='paid'&&Boolean(data.paid_at);
 const inspection=Boolean(data?.admin_inspection||data?.preview);
 const app=data?.applicationId,location=data?.locationId,provider=data?.provider,environment=data?.environment;
 const showCard=Boolean(data&&!paid&&(data.can_pay||inspection));
 useEffect(()=>{
  if(!showCard||!app||!location)return;
  let disposed=false,mounted:Card|undefined,slot:HTMLDivElement|undefined;
  setReady(false);
  void(async()=>{try{
   if(provider!=='square'||environment!=='live')throw new Error('Square LIVE renewal card form is unavailable.');
   const sdk=await loadSquare();mounted=await sdk.payments(app,location).card({style:{'.input-container':{borderColor:'#2a2a2a',borderRadius:'12px'},'.input-container.is-focus':{borderColor:'#0fd8c4'},input:{backgroundColor:'#0b0b0b',color:'#ffffff',fontSize:'18px'},'input::placeholder':{color:'#6b7280'},'.message-text':{color:'#9ca3af'}}});
   if(disposed){await mounted.destroy();return;}if(!host.current)throw new Error('Card form unavailable.');
   slot=document.createElement('div');host.current.replaceChildren(slot);await mounted.attach(slot);
   if(disposed){await mounted.destroy();slot.remove();return;}card.current=mounted;setReady(true);
  }catch(failure){if(!disposed)setMessage(failure instanceof Error?failure.message:'Square card form unavailable.');}})();
  return()=>{disposed=true;card.current=undefined;if(mounted)void mounted.destroy().finally(()=>slot?.remove());else slot?.remove();};
 },[showCard,app,location,provider,environment]);
 const pay=async()=>{
  if(inspection){setMessage('Admin inspection — this is the live Square card form. No payment or deposit authorization can be submitted from this view.');return;}
  if(lock.current||!card.current||attempted||!data?.can_pay)return;
  lock.current=true;setWorking(true);setMessage('');
  try{
   const token=await card.current.tokenize({amount:(data.amount_cents/100).toFixed(2),currencyCode:'USD',intent:'CHARGE',customerInitiated:true,sellerKeyedIn:false,billingContact:{email:user?.email}});
   if(token.status!=='OK'||!token.token)throw new Error('Card verification was unsuccessful. Review the card fields.');
   setAttempted(true);
   const result=await renewalRequest({action:'pay',periodId,token:token.token});
   if(result.payment_status!=='paid')setMessage('Your payment needs a status check. Do not submit another payment.');
   await refetch();
  }catch(failure){setMessage(failure instanceof Error?failure.message:'Check the existing payment before retrying.');}finally{lock.current=false;setWorking(false);}
 };
 const status=async()=>{if(lock.current||inspection)return;lock.current=true;setWorking(true);setMessage('');try{const result=await renewalRequest({action:'status',periodId});if(['failed','canceled'].includes(result.checkout_state||''))setAttempted(false);else if(result.checkout_state)setAttempted(true);await refetch();}catch(failure){setMessage(failure instanceof Error?failure.message:'Payment status unavailable.');}finally{lock.current=false;setWorking(false);}};
 const loginPath='/auth?redirectTo='+encodeURIComponent('/booking/renewal?periodId='+encodeURIComponent(periodId));
 const pendingPayment=['processing','reconciliation_required'].includes(data?.checkout_state||'');
 return <MainLayout variant="booking"><main className="min-h-screen bg-black px-4 pb-24 pt-28"><section className="mx-auto max-w-md rounded-2xl border border-white/10 bg-black p-6 text-white"><ZonyxPayBrand/><div className="my-6 h-px bg-white/10"/><h1 className="text-2xl font-semibold">{paid?'Renewal Payment Confirmed':'Pay Your Rental Renewal'}</h1>
  {inspection&&<p role="status" className="mt-4 rounded-lg border border-amber-400/40 p-3 text-sm text-amber-200">Admin inspection — the live customer card form is shown below. Viewing it creates no payment and changes no reservation or deposit.</p>}
  {(loading||isLoading)&&<p className="mt-4">Loading renewal…</p>}
  {!previewToken&&!loading&&!user&&<><p className="mt-4 text-sm text-neutral-300">Sign in with the reservation account or your authorized Admin account to view this checkout.</p><Button asChild className="mt-6 w-full"><Link to={loginPath}>Sign in to continue</Link></Button></>}
  {error&&<p role="alert" className="mt-4 text-red-300">{error.message}</p>}
  {data&&<div className="mt-5 space-y-4 text-sm"><p>Reservation: <strong>{data.reservation_number}</strong></p><p>Renewal period: <strong>{data.period_start} → {data.period_end}</strong></p><p className="text-lg font-semibold">{paid?'Paid':'Amount due'}: {new Intl.NumberFormat('en-US',{style:'currency',currency:data.currency.toUpperCase()}).format(data.amount_cents/100)}</p><p className="text-neutral-400">This payment covers only this renewal period. Your original rental payment and security deposit remain separate.</p>
   {paid?<p role="status" className="text-[#0fd8c4]">Your renewal payment has been verified. No additional payment is needed for this period.</p>:showCard?<><p className="text-xs text-neutral-400">Secure card payment · Square</p><div ref={host} aria-label="Secure Square card fields" className="min-h-[100px] [&_iframe]:!bg-transparent" style={macSafari?{transform:'translateZ(0)',WebkitTransform:'translateZ(0)'}:undefined}/>{!ready&&!message&&<p role="status">Loading secure card fields…</p>}<Button className="h-12 w-full bg-[#0fd8c4] text-[#031311] hover:bg-[#2fe6d3]" onClick={()=>void pay()} disabled={!ready||working||!inspection&&(attempted||pendingPayment)}>{working?'Processing renewal…':'Pay Renewal'}</Button></>:<p role="status">{data.plan_status!=='active'?'This extension is not active yet. Contact ZONYX before paying.':'This renewal amount needs review. Contact ZONYX before paying.'}</p>}
   {!inspection&&!paid&&<Button variant="outline" className="w-full" disabled={working} onClick={()=>void status()}>Check Payment Status</Button>}
  </div>}
  {message&&<p role="status" className="mt-4 text-sm text-amber-200">{message}</p>}<p className="mt-6 text-xs text-neutral-400">Questions? <a href="mailto:support@gozonyx.com" className="underline">support@gozonyx.com</a></p>
 </section></main></MainLayout>;
}
