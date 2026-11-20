import { PayPalClient } from './paypal-client.ts';
import { PaymentError, assertCardCaptureEligible, validatePayPalOrder, type PayPalOrder } from './payment-policy.ts';
export type LinkPayment = {
 id:string; quote_id:string; installment_number:number; amount_cents:number; currency:string; due_date:string;
 provider:'paypal'; environment:'sandbox'|'live'; review_only:boolean; enabled:boolean; state:string;
 order_id:string|null; capture_id:string|null; create_request_id:string; capture_request_id:string; accepted_at:string|null;
};
export type UpgradeQuote = {id:string;reservation_number:string;guest_name:string;quote:Record<string,unknown>;agreement_text:string;agreement_hash:string};
export interface LinkStore {
 byToken(hash:string):Promise<LinkPayment|null>;
 byId(id:string):Promise<LinkPayment|null>;
 quote(id:string):Promise<UpgradeQuote>;
 rpc(name:string,args:Record<string,unknown>):Promise<any>;
 event(id:string,paymentId:string,type:string):Promise<void>;
}
export type LinkProvider = Pick<PayPalClient,'environment'|'createOrder'|'getOrder'|'captureOrder'|'browserClientToken'|'verifyWebhook'>;
export const hashLinkToken = async(value:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function standaloneOrderInput(p:LinkPayment,reference:string,description?:string) {
 return {intent:'CAPTURE',purchase_units:[{reference_id:p.id,custom_id:p.id,invoice_id:`ZONYX-LINK-${p.id}`,description:description?`${reference} — ${description}`:`${reference} Cybertruck upgrade — payment ${p.installment_number}`,amount:{currency_code:p.currency,value:(p.amount_cents/100).toFixed(2)}}],payment_source:{card:{attributes:{verification:{method:'SCA_ALWAYS'}}}}};
}
function validateOrder(order:PayPalOrder,p:LinkPayment) {
 validatePayPalOrder(order,{id:p.id,order_id:p.order_id,amount_cents:p.amount_cents,currency:p.currency});
 return order.purchase_units?.[0].payments?.captures?.[0];
}
export function standaloneService(store:LinkStore,env:(name:string)=>string|undefined,provider:()=>LinkProvider) {
 const gate=(p:LinkPayment)=>{
  if(p.review_only||!p.enabled||env('STANDALONE_PAYPAL_LINKS_ENABLED')!=='true')throw new PaymentError(403,'This review cannot submit a payment.');
  if(env('PAYPAL_PROVIDER_LOCK_READY')!=='true'||env('PAYPAL_ENVIRONMENT')!==p.environment||(p.environment==='live'&&env('STANDALONE_PAYPAL_LIVE_APPROVED')!=='true'))throw new PaymentError(503,'Payment link is not activated.');
 };
 const client=(p:LinkPayment)=>{gate(p);const c=provider();if(c.environment!==p.environment)throw new PaymentError(409,'Payment environment mismatch.');return c;};
 const details=async(p:LinkPayment)=>{
  const q=await store.quote(p.quote_id);
  return {paymentId:p.id,quoteId:q.id,reference:q.reservation_number,customerName:q.guest_name,quote:q.quote,agreement:{text:q.agreement_text,hash:q.agreement_hash},amountCents:p.amount_cents,currency:p.currency,dueDate:p.due_date,provider:p.provider,environment:p.environment,state:p.state,reviewOnly:p.review_only,testOnly:p.environment==='sandbox',captureEnabled:env('STANDALONE_PAYPAL_CAPTURE_ENABLED')==='true',canPay:p.enabled&&!p.review_only&&['ready','awaiting_approval'].includes(p.state)&&env('STANDALONE_PAYPAL_LINKS_ENABLED')==='true'&&env('PAYPAL_PROVIDER_LOCK_READY')==='true'&&env('PAYPAL_ENVIRONMENT')===p.environment&&(p.environment!=='live'||env('STANDALONE_PAYPAL_LIVE_APPROVED')==='true'),orderId:p.order_id};
 };
 const reconcile=async(p:LinkPayment,order:PayPalOrder)=>{
  const capture=validateOrder(order,p);
  if(!p.order_id){p=await store.rpc('attach_standalone_paypal_order',{_id:p.id,_order_id:order.id});}
  if(capture&&['COMPLETED','REFUNDED','REVERSED'].includes(capture.status)){
   p=await store.rpc('settle_standalone_paypal_link',{_id:p.id,_order_id:order.id,_capture_id:capture.id,_amount_cents:p.amount_cents,_currency:p.currency,_outcome:capture.status==='COMPLETED'?'paid':capture.status.toLowerCase()});
  } else if(capture||order.status==='COMPLETED') {
   await store.rpc('flag_standalone_paypal_uncertain',{_id:p.id}); p=(await store.byId(p.id))!;
  }
  return p;
 };
 return {
  async action(input:Record<string,unknown>){
   const allowed:Record<string,string[]>={details:['action','token'],'client-token':['action','token'],create:['action','token','agreementAccepted','agreementHash','payerName','payerEmail'],capture:['action','token'],status:['action','token']};
   if(typeof input.action!=='string'||!allowed[input.action]||Object.keys(input).some(k=>!allowed[input.action as string].includes(k))||typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token))throw new PaymentError(400,'Invalid payment-link request.');
   let p=await store.byToken(await hashLinkToken(input.token));
   if(!p||!p.enabled)throw new PaymentError(404,'Payment link unavailable.');
   if(input.action==='details')return details(p);
   // Review mode exits before constructing a provider client or issuing any network call.
   if(input.action==='status'&&p.review_only)return details(p);
   if(input.action==='capture'&&env('STANDALONE_PAYPAL_CAPTURE_ENABLED')!=='true')throw new PaymentError(403,'Payment capture is disabled in this review.');
   const paypal=client(p);
   if(input.action==='client-token'){
    if(p.state!=='ready'&&p.state!=='awaiting_approval')throw new PaymentError(409,'Check the existing payment status.');
    return {clientToken:await paypal.browserClientToken(),environment:p.environment};
   }
   if(input.action==='create'){
    if(input.agreementAccepted!==true||typeof input.agreementHash!=='string'||typeof input.payerName!=='string'||typeof input.payerEmail!=='string')throw new PaymentError(400,'Review the Rental Agreement and cardholder details.');
    if(input.agreementHash!==(await store.quote(p.quote_id)).agreement_hash)throw new PaymentError(400,'Review the Rental Agreement and cardholder details.');
    const claim=await store.rpc('claim_herman_deposit_paypal_create',{_id:p.id,_agreement_hash:input.agreementHash,_payer_name:input.payerName,_payer_email:input.payerEmail}); p=claim.payment;
    if(!claim.dispatch){
     if(p!.state!=='awaiting_approval'||!p!.order_id)return details(p!);
     // A durable link must not blindly return a short-lived provider order.
     // A missing/404 order remains uncertain: never infer unpaid from its age.
     const existing=await paypal.getOrder(p!.order_id);
     p=await reconcile(p!,existing);
     if(p.state!=='awaiting_approval')return details(p);
     if(['CREATED','APPROVED','PAYER_ACTION_REQUIRED'].includes(existing.status)){
      if(existing.purchase_units?.some(u=>(u.payments?.authorizations?.length??0)>0||(u.payments?.captures?.length??0)>0))throw new PaymentError(409,'Existing financial activity requires reconciliation.');
      return {...await details(p),canApprove:true};
     }
     if(existing.status!=='VOIDED'||existing.purchase_units?.some(u=>(u.payments?.authorizations?.length??0)>0||(u.payments?.captures?.length??0)>0))throw new PaymentError(409,'Existing financial activity requires reconciliation.');
     if(p.environment!=='sandbox'||env('STANDALONE_PAYPAL_ORDER_RENEWAL_ENABLED')!=='true')throw new PaymentError(409,'Order renewal is not enabled.');
     const merchant=(existing.purchase_units?.[0] as {payee?:{merchant_id?:string}}|undefined)?.payee?.merchant_id;
     if(!merchant||!/^[A-Z0-9]+$/.test(merchant))throw new PaymentError(409,'Existing PayPal merchant must be verified before renewal.');
     const previous=p.order_id;
     const renewal=await store.rpc('claim_standalone_paypal_renewal',{_id:p.id,_old_order_id:previous,_merchant_id:merchant,_provider_status:existing.status});
     p=renewal.payment;
     if(!renewal.dispatch)return details(p!);
     try{
      const q=await store.quote(p!.quote_id);
      const body=standaloneOrderInput(p!,q.reservation_number,String(q.quote.title));
      const unit={...body.purchase_units[0],invoice_id:`ZONYX-LINK-${p!.id}-${p!.create_request_id}`,payee:{merchant_id:merchant}};
      const created=await paypal.createOrder({...body,purchase_units:[unit]},p!.create_request_id);
      // Read canonical provider evidence before attaching the replacement.
      const verified=await paypal.getOrder(created.id);
      validateOrder(verified,{...p!,order_id:created.id});
      if(verified.status!=='CREATED'||(verified.purchase_units?.[0] as {payee?:{merchant_id?:string}})?.payee?.merchant_id!==merchant||verified.purchase_units?.some(u=>(u.payments?.captures?.length??0)>0||(u.payments?.authorizations?.length??0)>0))throw new PaymentError(409,'Replacement order requires reconciliation.');
      p=await store.rpc('attach_standalone_paypal_renewal',{_id:p!.id,_old_order_id:previous,_new_order_id:verified.id,_request_id:p!.create_request_id});
      return {...await details(p!),canApprove:true};
     }catch(error){await store.rpc('flag_standalone_paypal_uncertain',{_id:p!.id});throw error;}
    }
    try {
     const q=await store.quote(p!.quote_id);
     const order=await paypal.createOrder(standaloneOrderInput(p!,q.reservation_number,String(q.quote.title)),p!.create_request_id);
     validateOrder(order,p!);
     p=await store.rpc('attach_standalone_paypal_order',{_id:p!.id,_order_id:order.id});
     return {...await details(p!),canApprove:true};
    }catch(error){await store.rpc('flag_standalone_paypal_uncertain',{_id:p!.id});throw error;}
   }
   if(input.action==='status'){
    if(!p.order_id)return details(p);
    const order=await paypal.getOrder(p.order_id);p=await reconcile(p,order);let cardVerified=false;try{assertCardCaptureEligible(order);cardVerified=true;}catch{/* Missing provider authentication remains unverified. */}return {...await details(p),providerStatus:order.status,cardVerified};
   }
   if(input.action==='capture'){
    if(['paid','refunded','reversed'].includes(p.state))return details(p);
    if(!p.order_id)throw new PaymentError(409,'Check the existing payment status.');
    const order=await paypal.getOrder(p.order_id);
    const cap=validateOrder(order,p);
    if(cap){p=await reconcile(p,order);return details(p);}
    if(!['APPROVED','CREATED'].includes(order.status))throw new PaymentError(409,'Card approval is required for this payment.');
    assertCardCaptureEligible(order);
    const claim=await store.rpc('claim_standalone_paypal_capture',{_id:p.id});p=claim.payment;
    if(!claim.dispatch)return details(p!);
    try { p=await reconcile(p!,await paypal.captureOrder(p!.order_id!,p!.capture_request_id));return details(p!); }
    catch(error){await store.rpc('flag_standalone_paypal_uncertain',{_id:p!.id});throw error;}
   }
   throw new PaymentError(400,'Unsupported action.');
  },
  async webhook(headers:Headers,event:any){
   if(!event||typeof event.id!=='string'||typeof event.event_type!=='string'||!env('STANDALONE_PAYPAL_WEBHOOK_ID'))throw new PaymentError(400,'Webhook identity unavailable.');
   const paypal=provider();
   if(!await paypal.verifyWebhook(headers,event,env('STANDALONE_PAYPAL_WEBHOOK_ID')!))throw new PaymentError(400,'Invalid webhook signature.');
   if(!['CHECKOUT.ORDER.APPROVED','CHECKOUT.ORDER.COMPLETED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'].includes(event.event_type))return {received:true};
   const orderId=event.resource?.supplementary_data?.related_ids?.order_id||(event.event_type.startsWith('CHECKOUT.ORDER.')?event.resource?.id:undefined);
   if(typeof orderId!=='string'||!/^[A-Za-z0-9]+$/.test(orderId))throw new PaymentError(400,'Webhook order unavailable.');
   // Fetch canonical provider evidence; never settle from webhook amount/status alone.
   const order=await paypal.getOrder(orderId);
   const id=order.purchase_units?.[0]?.custom_id;
   if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return {received:true};
   const p=await store.byId(id);if(!p)return {received:true};
   gate(p);if(paypal.environment!==p.environment)throw new PaymentError(409,'Webhook environment mismatch.');
   await reconcile(p,order);await store.event(event.id,p.id,event.event_type);
   return {received:true};
  },
 };
}
export function supabaseLinkStore(db:any):LinkStore {
 const one=async(table:string,column:string,id:string)=>{const r=await db.from(table).select('*').eq(column,id).maybeSingle();if(r.error)throw new PaymentError(503,'Payment record unavailable.');return r.data;};
 return {byToken:hash=>one('standalone_paypal_links','token_hash',hash),byId:id=>one('standalone_paypal_links','id',id),quote:async id=>{const q=await one('standalone_upgrade_quotes','id',id);if(!q)throw new PaymentError(404,'Quote unavailable.');return q;},rpc:async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw new PaymentError(409,'Payment state could not be verified. Check the existing payment.');return r.data;},event:async(id,paymentId,type)=>{const r=await db.from('standalone_paypal_events').upsert({event_id:id,payment_id:paymentId,event_type:type},{onConflict:'event_id',ignoreDuplicates:true});if(r.error)throw new PaymentError(503,'Webhook persistence pending.');}};
}
export function standaloneHttp(service:ReturnType<typeof standaloneService>,webhook=false){
 return async(request:Request)=>{
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Referrer-Policy':'no-referrer'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed.'}),{status:405,headers});
  try{const raw=await request.text();if(raw.length>100000)throw new PaymentError(413,'Request too large.');const input=JSON.parse(raw);const result=webhook?await service.webhook(request.headers,input):await service.action(input);return new Response(JSON.stringify(result),{status:200,headers});}
  catch(error){return new Response(JSON.stringify({error:error instanceof PaymentError?error.message:'Payment status is unavailable. Check this payment before retrying.'}),{status:error instanceof PaymentError?error.status:503,headers});}
 };
}

