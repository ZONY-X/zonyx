import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { ZonyxPayBrand } from '@/components/rental/ZonyxPayBrand';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RentalAgreementDocument } from '@/components/legal/RentalAgreementDocument';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

type Details = { rental_agreement?:{version:string;document_hash:string;rendered_text:string;consent_text:string}|null; period_id: string; reservation_number: string; period_start: string; period_end: string; amount_cents: number; currency: string; payment_status: string; paid_at: string | null; plan_status: string; can_pay: boolean; preview?: boolean; admin_inspection?: boolean; checkout_state?: string | null; provider: string; environment: string; applicationId: string; locationId: string; live_test?:boolean; test_id?:string; description?:string; cof_required?:boolean; terms_version?:string; authorization_terms?:string; authorization_context?:{rental_schedule?:Array<{period_start:string;period_end:string;amount_cents:number;billing_date:string}>}; card_saved?:boolean; future_authorization_active?:boolean; card_last4?:string; management_url?:string; setup_retry_allowed?:boolean; card_save_pending?:boolean; authorization_view?:boolean; authorization_withdrawn?:boolean; authorization_state?:string; withdrawn?:boolean; terms_text?:string; accepted_at?:string };
type Card = { configure(options:{postalCode:string}):Promise<void>; attach(element: HTMLElement): Promise<void>; destroy(): Promise<void>; tokenize(details: Record<string, unknown>): Promise<{status: string; token?: string}> };
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
 const periodId=params.get('periodId')||'',previewToken=params.get('preview')||'',paymentLink=params.get('link')||'',testLink=params.get('test')||'',authorizationToken=params.get('authorization')||'';
 const paymentIdentity=testLink?{testLink}:paymentLink?{paymentLink}:{periodId};
 const submissionKey='zonyx-cof-submission:'+(testLink||paymentLink||periodId);
 const [submissionId,setSubmissionId]=useState(()=>{let id=sessionStorage.getItem(submissionKey);if(!id){id=crypto.randomUUID();sessionStorage.setItem(submissionKey,id);}return id;});
 const [payer,setPayer]=useState({givenName:'',familyName:'',email:'',postalCode:'',country:'US'});
 const [storageConsent,setStorageConsent]=useState(false),[futureConsent,setFutureConsent]=useState(false);
 const [termsOpen,setTermsOpen]=useState(false),[agreementOpen,setAgreementOpen]=useState(false);
 const billingValid=Boolean(payer.givenName.trim()&&payer.familyName.trim()&&/^\S+@\S+\.\S+$/.test(payer.email)&&payer.postalCode.trim().length>=2&&/^[A-Z]{2}$/.test(payer.country));
 const [working,setWorking]=useState(false),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[attempted,setAttempted]=useState(false);
 const host=useRef<HTMLDivElement>(null),card=useRef<Card>(),lock=useRef(false);
 const {data,error,isLoading,refetch}=useQuery({queryKey:['guest-renewal',periodId,previewToken,paymentLink,testLink,authorizationToken,submissionId,user?.id],queryFn:()=>renewalRequest(previewToken?{action:'details',previewToken}:{action:'details',...paymentIdentity,submissionId}),enabled:!authorizationToken&&Boolean(testLink||paymentLink||previewToken||periodId&&user),retry:false});
 const formattedAmount=data?new Intl.NumberFormat('en-US',{style:'currency',currency:data.currency.toUpperCase()}).format(data.amount_cents/100):'';
 const paid=data?.payment_status==='paid'&&Boolean(data.paid_at);
 const inspection=Boolean(data?.admin_inspection||data?.preview);
 const app=data?.applicationId,location=data?.locationId,provider=data?.provider,environment=data?.environment;
 const showCard=Boolean(data&&!data.authorization_view&&!paid&&(data.can_pay||inspection));
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
  if(data.cof_required&&(!storageConsent||!futureConsent||!billingValid)){setMessage('Enter your billing details and affirm both authorizations before paying.');return;}
  lock.current=true;setWorking(true);setMessage('');
  try{
   if(data.cof_required)await card.current.configure({postalCode:payer.postalCode});
   const token=await card.current.tokenize({amount:(data.amount_cents/100).toFixed(2),currencyCode:'USD',intent:data.cof_required?'CHARGE_AND_STORE':'CHARGE',customerInitiated:true,sellerKeyedIn:false,billingContact:data.cof_required?{givenName:payer.givenName,familyName:payer.familyName,email:payer.email,postalCode:payer.postalCode,countryCode:payer.country}:paymentLink?{}:{email:user?.email}});
   if(token.status!=='OK'||!token.token)throw new Error('Card verification was unsuccessful. Review the card fields.');
   setAttempted(true);
   const result=await renewalRequest({action:'pay',...paymentIdentity,token:token.token,submissionId,payer,storageConsent,futureConsent,termsVersion:data.terms_version,...(data.rental_agreement?{rentalAgreementAccepted:futureConsent,rentalAgreementHash:data.rental_agreement.document_hash}:{})});
   if(result.payment_status!=='paid')setMessage('Your payment needs a status check. Do not submit another payment.');
   await refetch();
  }catch(failure){setMessage(failure instanceof Error?failure.message:'Check the existing payment before retrying.');}finally{lock.current=false;setWorking(false);}
 };
 const status=async()=>{if(lock.current||inspection)return;lock.current=true;setWorking(true);setMessage('');try{const result=await renewalRequest({action:'status',...paymentIdentity,submissionId});if(['failed','canceled'].includes(result.checkout_state||'')){setAttempted(false);const next=crypto.randomUUID();sessionStorage.setItem(submissionKey,next);setSubmissionId(next);}else if(result.setup_retry_allowed)setAttempted(false);else if(result.checkout_state)setAttempted(true);await refetch();}catch(failure){setMessage(failure instanceof Error?failure.message:'Payment status unavailable.');}finally{lock.current=false;setWorking(false);}};
 const loginPath='/auth?redirectTo='+encodeURIComponent('/booking/renewal?periodId='+encodeURIComponent(periodId));
 const pendingPayment=['processing','reconciliation_required'].includes(data?.checkout_state||'')&&!data?.setup_retry_allowed;
 return <MainLayout variant="booking"><main className="min-h-screen bg-black px-4 pb-24 pt-28"><section className="mx-auto max-w-md rounded-2xl border border-white/10 bg-black p-6 text-white"><ZonyxPayBrand/><div className="my-6 h-px bg-white/10"/><h1 className="text-2xl font-semibold">{data?.live_test?paid?'LIVE Test Payment Confirmed':'LIVE Payment Test':paid?'Renewal Payment Confirmed':'Pay Your Rental Renewal'}</h1>
  {inspection&&<p role="status" className="mt-4 rounded-lg border border-amber-400/40 p-3 text-sm text-amber-200">Admin inspection — the live customer card form is shown below. Viewing it creates no payment and changes no reservation or deposit.</p>}
  {(loading||isLoading)&&<p className="mt-4">Loading renewal…</p>}
  {!authorizationToken&&!testLink&&!paymentLink&&!previewToken&&!loading&&!user&&<><p className="mt-4 text-sm text-neutral-300">Sign in with the reservation account or your authorized Admin account to view this checkout.</p><Button asChild className="mt-6 w-full"><Link to={loginPath}>Sign in to continue</Link></Button></>}
  {authorizationToken&&<p role="status" className="mt-4 text-sm">To request withdrawal of authorization for future charges, please contact support@gozonyx.com. Withdrawal does not cancel your rental agreement, outstanding balances, or payment obligations under your rental agreement.</p>}
  {error&&<p role="alert" className="mt-4 text-red-300">{error.message}</p>}
  {data&&!authorizationToken&&<div className="mt-5 space-y-4 text-sm">{data.live_test?<p>Independent LIVE Square test · not linked to any reservation</p>:<><p>Reservation: <strong>{data.reservation_number}</strong></p><p>ZONYX Rental Renewal</p><p>Renewal period: <strong>{data.period_start} → {data.period_end}</strong></p></>}<p className="text-lg font-semibold">{paid?'Paid':'Amount due'}: {new Intl.NumberFormat('en-US',{style:'currency',currency:data.currency.toUpperCase()}).format(data.amount_cents/100)}</p><p className="text-neutral-400">{data.live_test?`This is a real, one-time ${formattedAmount} USD payment. It does not pay or change ZNX-000150 or any rental reservation. No security hold is created.`:'This payment covers the renewal period shown above. Subsequent rental periods will be billed separately according to your rental schedule. Your security hold was arranged separately. No additional security hold will be placed for this renewal.'}</p>
   {paid?<p role="status" className="text-[#0fd8c4]">{data.live_test?`Square has confirmed your ${formattedAmount} payment. Do not pay again.`:'Your renewal payment has been verified. No additional payment is needed for this period.'}</p>:showCard?<><p className="text-xs text-neutral-400">Secure card payment · Square</p><div ref={host} aria-label="Secure Square card fields" className="min-h-[100px] [&_iframe]:!bg-transparent" style={macSafari?{transform:'translateZ(0)',WebkitTransform:'translateZ(0)'}:undefined}/>{!ready&&!message&&<p role="status">Loading secure card fields…</p>}{data.cof_required&&!inspection&&<fieldset disabled={working||attempted||pendingPayment} className="space-y-3 rounded-lg border border-white/15 p-3"><legend className="px-1 font-semibold">Cardholder and payment authorization</legend>{(['givenName','familyName','email','postalCode','country'] as const).map(field=><div key={field}><Label htmlFor={'cof-'+field}>{({givenName:'First name',familyName:'Last name',email:'Cardholder email',postalCode:'Billing postal code',country:'Billing country (two-letter code)'})[field]}</Label><Input id={'cof-'+field} type={field==='email'?'email':'text'} autoComplete={({givenName:'given-name',familyName:'family-name',email:'email',postalCode:'postal-code',country:'country'})[field]} maxLength={field==='country'?2:field==='postalCode'?16:field==='email'?254:80} value={payer[field]} onChange={event=>setPayer(current=>({...current,[field]:field==='country'?event.target.value.toUpperCase():event.target.value}))}/></div>)}<p className="text-xs text-neutral-400">Your billing postal code is used for both Square card verification and card storage.</p><div className="space-y-3 text-xs text-neutral-300">{data.authorization_context?.rental_schedule&&<details><summary className="cursor-pointer underline">Rental periods and billing schedule</summary>{data.authorization_context.rental_schedule.map(period=><p key={period.period_start}>{period.period_start} → {period.period_end} · billing date {period.billing_date}</p>)}</details>}</div><label className="flex items-start gap-2"><input type="checkbox" checked={storageConsent} onChange={event=>setStorageConsent(event.target.checked)} className="mt-1"/><span>I consent to Square securely saving my card for ZONYX.</span></label><label className="flex items-start gap-2"><input type="checkbox" checked={futureConsent} onChange={event=>setFutureConsent(event.target.checked)} className="mt-1"/><span>I am the cardholder or authorized user and authorize future charges under these <a href="#payment-authorization-terms" aria-haspopup="dialog" aria-controls="payment-authorization-terms" className="text-[#0fd8c4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={event=>{event.preventDefault();event.stopPropagation();setTermsOpen(true);}}>Terms</a>{data.rental_agreement&&<> and accept the <a href="#renewal-rental-agreement" aria-haspopup="dialog" aria-controls="renewal-rental-agreement" className="text-[#0fd8c4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={event=>{event.preventDefault();event.stopPropagation();setAgreementOpen(true);}}>Rental Agreement</a></>}.</span></label></fieldset>}<Button className="h-12 w-full bg-[#0fd8c4] text-[#031311] hover:bg-[#2fe6d3]" onClick={()=>void pay()} disabled={!ready||working||!inspection&&(attempted||pendingPayment||Boolean(data.cof_required)&&(!storageConsent||!futureConsent||!billingValid))}>{working?'Processing payment…':data.live_test?`Pay ${formattedAmount}`:'Pay Renewal'}</Button></>:<p role="status">{data.plan_status!=='active'?'This extension is not active yet. Contact ZONYX before paying.':'This renewal amount needs review. Contact ZONYX before paying.'}</p>}
   {paid&&data.cof_required&&<p role="status" className="text-sm text-neutral-300">{data.authorization_withdrawn?'Payment confirmed. Future-charge authorization has been withdrawn.':data.card_saved&&data.future_authorization_active?`Square confirmed your saved card${data.card_last4?' ending '+data.card_last4:''}. Future-charge authorization is recorded.`:'Payment confirmed. Card storage or authorization verification is pending; do not pay again.'}</p>}
   {!inspection&&(!paid||data.card_save_pending)&&<Button variant="outline" className="w-full" disabled={working} onClick={()=>void status()}>{paid?'Verify Saved Card':'Check Payment Status'}</Button>}
  </div>}
  {data?.rental_agreement&&<Dialog open={agreementOpen} onOpenChange={setAgreementOpen}><DialogContent id="renewal-rental-agreement" aria-describedby={undefined} className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-lg border-white/20 bg-neutral-950 text-white"><DialogTitle className="pr-6 text-xl">Rental Agreement — v{data.rental_agreement.version}</DialogTitle><div className="space-y-5 break-words text-base leading-relaxed"><RentalAgreementDocument text={data.rental_agreement.rendered_text}/></div></DialogContent></Dialog>}
  <Dialog open={termsOpen} onOpenChange={setTermsOpen}><DialogContent id="payment-authorization-terms" className="max-h-[80dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-lg border-white/20 bg-neutral-950 text-white"><DialogTitle className="pr-6 text-xl">Payment Authorization Terms</DialogTitle><DialogDescription className="whitespace-pre-line text-base leading-relaxed text-neutral-200">{data?.authorization_terms}</DialogDescription></DialogContent></Dialog>
  {message&&<p role="status" className="mt-4 text-sm text-amber-200">{message}</p>}<p className="mt-6 text-xs text-neutral-400">Questions? <a href="mailto:support@gozonyx.com" className="underline">support@gozonyx.com</a></p>
 </section></main></MainLayout>;
}
