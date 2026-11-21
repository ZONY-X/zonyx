import {useEffect,useRef,useState} from 'react';
import {usd} from '@/components/payment-links/UpgradeQuote';
import {ZonyxPayBrand} from '@/components/rental/ZonyxPayBrand';
import {loadPayPalSdk,type CardSession} from '@/lib/paypal-sdk';
type Details={paymentId:string;quoteId:string;reference:string;customerName:string;quote:{reservation:string;title:string;startAt:string;endAt:string;dailyRateCents:number;subtotalCents:number;serviceFeeCents:number;taxesCents:number};agreement:{text:string;hash:string};amountCents:number;currency:string;dueDate:string;provider:'paypal';environment:'sandbox'|'live';state:string;reviewOnly:boolean;testOnly:boolean;captureEnabled:boolean;providerStatus?:string;cardVerified?:boolean;canPay:boolean;orderId?:string;canApprove?:boolean};
const preview=import.meta.env.VITE_STANDALONE_LINK_PREVIEW==='true';
const endpoint=import.meta.env.VITE_STANDALONE_PAYMENT_ENDPOINT||(preview?'/api/standalone-paypal-link':`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/standalone-paypal-link`);
async function request(token:string,action:string,extra:Record<string,unknown>={}){
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(!preview?{apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}:{})},body:JSON.stringify({action,token,...extra}),cache:'no-store',referrerPolicy:'no-referrer'});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Payment status unavailable.');return result;
}
export default function StandalonePaymentLink(){
 const token=new URLSearchParams(window.location.search).get('link')||'';
 const [data,setData]=useState<Details>(),[error,setError]=useState(''),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[uncertain,setUncertain]=useState(false);
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[postal,setPostal]=useState('');
 const number=useRef<HTMLDivElement>(null),expiry=useRef<HTMLDivElement>(null),cvv=useRef<HTMLDivElement>(null),session=useRef<CardSession>(),lock=useRef(false);
 const submissionId=useRef(crypto.randomUUID());
 useEffect(()=>{let disposed=false;setData(undefined);setError('');setAccepted(false);setUncertain(false);setReady(false);session.current=undefined;void request(token,'details').then(result=>{if(!disposed)setData(result);}).catch(e=>{if(!disposed)setError(e.message);});return()=>{disposed=true;};},[token]);
 useEffect(()=>{
  if(!data||data.reviewOnly||!data.canPay)return;
  let disposed=false;const hosts=[number.current,expiry.current,cvv.current];setReady(false);
  void(async()=>{try{
   const config=await request(token,'client-token');if(disposed)return;
   const namespace=await loadPayPalSdk(config.environment);const sdk=await namespace.createInstance({clientToken:config.clientToken,components:['card-fields'],pageType:'checkout'});
   const eligible=await sdk.findEligibleMethods({currencyCode:'USD'});if(!eligible.isEligible('advanced_cards'))throw Error('Secure card payment is unavailable. Contact support.');
   if(disposed)return;const card=sdk.createCardFieldsOneTimePaymentSession();
   for(const [host,type,placeholder] of [[number.current,'number','Card number'],[expiry.current,'expiry','MM/YY'],[cvv.current,'cvv','Security code']] as const){const field=card.createCardFieldsComponent({type,placeholder,style:{input:{fontFamily:'Arial, sans-serif',fontSize:'16px',color:'#e5e7eb',background:'#050b09',padding:'12px',borderRadius:'12px',border:'0'}}});field.setAttribute('aria-label',placeholder);host?.replaceChildren(field);}
   session.current=card;setReady(true);
  }catch(e){if(!disposed)setMessage(e instanceof Error?e.message:'Secure card fields unavailable.');}})();
  return()=>{disposed=true;session.current=undefined;hosts.forEach(host=>host?.replaceChildren());};
 },[token,data?.reviewOnly,data?.canPay,data?.environment]);
 async function status(){if(lock.current)return;lock.current=true;setBusy(true);try{const result=await request(token,'status');setData(result);setUncertain(!['ready','awaiting_approval','paid','refunded','reversed'].includes(result.state));setMessage(result.cardVerified&&!result.captureEnabled?'PayPal sandbox card verification completed. No payment was captured.':result.state==='paid'?'Your payment has been verified.':result.state==='awaiting_approval'?'The same payment is ready for card approval.':'Payment status checked.');}catch(e){setMessage(e instanceof Error?e.message:'Status unavailable.');}finally{setBusy(false);lock.current=false;}}
 async function pay(){
  if(lock.current||!data?.canPay||data.reviewOnly||!session.current||!accepted||uncertain||!ready)return;
  lock.current=true;setBusy(true);setMessage('');
  try{
   const created=await request(token,'create',{agreementAccepted:true,agreementHash:data.agreement.hash,payerName:name,payerEmail:email});
   if(created.state==='paid'){setData(created);return;}
   if(!created.canApprove||!created.orderId){setData(created);throw Error('Check the existing payment status before continuing.');}
   const approved=await session.current!.submit(created.orderId,{billingAddress:{postalCode:postal,countryCode:'US'}});
   if(approved.state!=='succeeded'||approved.data?.orderId!==created.orderId)throw Error('Card approval was not completed. Check the existing payment before retrying.');
   const result=await request(token,data.captureEnabled?'capture':'status');setData(result);setUncertain(data.captureEnabled&&result.state!=='paid');setMessage(!data.captureEnabled?(result.cardVerified?'PayPal sandbox card verification completed. No payment was captured.':'PayPal order received. Card authentication needs a status check.'):result.state==='paid'?`Your ${usd(data.amountCents)} payment has been verified.`:'Your payment needs a status check before continuing.');
  }catch(e){setUncertain(true);setMessage(e instanceof Error?e.message:'Check the existing payment before retrying.');}
  finally{setBusy(false);lock.current=false;}
 }
 const valid=name.trim().length>=2&&/^\S+@\S+\.\S+$/.test(email)&&postal.trim().length>=2;
 return <main className="standalone-page">
  {error?<section className="link-error" role="alert">{error}</section>:!data?<p className="link-loading" role="status">Loading your ZONYX payment…</p>:<>
   <section className="standalone-checkout" aria-label="ZONYX PAY rental extension payment" data-payment-id={data.paymentId} data-provider={data.provider}>
    <ZonyxPayBrand/>
    <hr/><header className="upgrade-quote">
     <div className="upgrade-header"><span className="upgrade-badge">RENTAL EXTENSION</span></div>
     <p className="upgrade-reservation">RESERVATION {data.quote.reservation}</p>
     <h1>{data.quote.title}</h1>
    </header>
    {data.state==='paid'&&<h2 className="payment-heading">Payment Confirmed</h2>}
    <div className="checkout-summary"><p>Reservation: <strong>{data.reference}</strong></p><p>{data.customerName}</p><p className="extension-period">November 21, 2026 · 1:00 PM<br/>November 22, 2026 · 1:00 PM<br/><span>Eastern Time · 1 day</span></p></div>
    <dl className="extension-breakdown" aria-label="Rental extension charges"><div><dt>Daily rate</dt><dd>{usd(data.quote.dailyRateCents)}</dd></div><div><dt>Rental subtotal</dt><dd>{usd(data.quote.subtotalCents)}</dd></div><div><dt>Service fee</dt><dd>{usd(data.quote.serviceFeeCents)}</dd></div><div><dt>Taxes</dt><dd>{usd(data.quote.taxesCents)}</dd></div><div className="extension-total"><dt>{data.state==='paid'?'Paid':'Total'}</dt><dd>{usd(data.amountCents)}</dd></div></dl>
    {(data.reviewOnly||data.testOnly)&&<p className="review-mode" role="status">{data.reviewOnly?'Private review · payment disabled':'PayPal Sandbox · capture disabled'}</p>}
    <details className="upgrade-agreement"><summary>View New Rental Extension Agreement</summary><div className="agreement-text">{data.agreement.text}</div></details>
    {data.state==='paid'?<p role="status" className="payment-confirmed">Your payment has been verified. No additional payment is needed for this link.</p>:<form onSubmit={e=>{e.preventDefault();void pay();}}>
     <p className="card-caption">Secure card payment · ZONYX Pay</p>
     {data.reviewOnly?<div className="review-card-fields" aria-label="Card fields preview — payment disabled"><div>Card number</div><div className="review-card-row"><div>MM/YY</div><div>Security code</div></div></div>:<div className="embedded-card-fields"><div ref={number}/><div className="card-row"><div ref={expiry}/><div ref={cvv}/></div></div>}
     <fieldset disabled={data.reviewOnly||busy||uncertain||!data.canPay}><legend className="sr-only">Cardholder verification</legend><label>Cardholder name<input autoComplete="cc-name" value={name} maxLength={160} onChange={e=>setName(e.target.value)} required/></label><label>Cardholder email<input type="email" autoComplete="email" value={email} maxLength={254} onChange={e=>setEmail(e.target.value)} required/></label><label>Billing postal code<input autoComplete="postal-code" value={postal} maxLength={16} onChange={e=>setPostal(e.target.value)} required/></label><label className="agreement-acceptance"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} required/><span>I have read and accept the Rental Extension Agreement and authorize this one-time $356.40 USD payment as the cardholder or authorized user.</span></label></fieldset>
     <button className="pay-button" type="submit" disabled={data.reviewOnly||busy||uncertain||!data.canPay||!ready||!accepted||!valid}>{busy?'Checking payment…':`Pay ${usd(data.amountCents)}`}</button>
    </form>}
    {!data.reviewOnly&&<button type="button" className="status-button" disabled={busy} onClick={()=>void status()}>Check Payment Status</button>}

    {message&&<p role="status" className="checkout-message">{message}</p>}
    <p className="checkout-support">Questions? <a href="mailto:support@gozonyx.com">support@gozonyx.com</a></p>
   </section>
  </>}
 </main>;
}
