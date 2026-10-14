import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {verifyRenewalPreview} from '../_shared/renewal-checkout.ts';
import {SquareClient,SquareCardDeclined} from '../_shared/square-client.ts';
import {assertSquareSandbox,squareSetting} from '../_shared/square-policy.ts';
import {squareRenewalEvidence,type RenewalAttempt} from '../_shared/square-renewal.ts';
import {CARD_TERMS_VERSION,authorizationTerms,validatePayer,authorizationForAttempt,ensureSquareCustomer,finalizeCheckoutCard,type CardDB} from '../_shared/square-card-authorization.ts';
const env=(name:string)=>Deno.env.get(name);
const cors={'Access-Control-Allow-Origin':'https://www.gozonyx.com','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const json=(status:number,body:unknown)=>Response.json(body,{status,headers:cors});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
 try{
  const url=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
  if(!url||!key||!anon)return json(503,{error:'Checkout unavailable.'});
  const input=await request.json();
  if(!input||Object.keys(input).some(k=>!['action','periodId','previewToken','token','paymentLink','testLink','payer','storageConsent','futureConsent','termsVersion','submissionId','authorizationToken'].includes(k)))return json(400,{error:'Unsupported checkout fields.'});
  if(input.authorizationToken||['authorizationDetails','withdrawAuthorization'].includes(input.action))return json(410,{error:'Self-service authorization management is unavailable. Please contact support@gozonyx.com.'});
  const service=createClient(url,key),db=service as unknown as CardDB;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:request.headers.get('authorization')||''}}});
  assertSquareSandbox(env);
  if(env('SQUARE_ENVIRONMENT')!=='live')return json(503,{error:'Square LIVE checkout unavailable. No payment was started.'});
  const client=new SquareClient(env),applicationId=squareSetting(env,'APPLICATION_ID');
  if(!applicationId?.startsWith('sq0idp-'))return json(503,{error:'Square LIVE card form unavailable.'});

  let details:Record<string,unknown>,link=input.testLink||input.paymentLink;
  const kind=input.testLink?'live_test':'renewal';
  if(link){
   if(typeof link!=='string'||!/^[a-f0-9]{64}$/.test(link))return json(404,{error:'Payment link unavailable.'});
   const {data,error}=await service.rpc(kind==='live_test'?'get_square_live_test_details':'get_public_square_renewal_details',{_token:link});
   if(error)return json(404,{error:'Payment link unavailable.'});details=data;
  }else if(input.previewToken){
   if(input.action!=='details')return json(403,{error:'Inspection cannot submit a payment.'});
   const preview=await verifyRenewalPreview(String(input.previewToken),key);details={...preview,preview:true,can_pay:false,payment_status:'payment_due',plan_status:'active'};
  }else{
   const {data:auth,error}=await userClient.auth.getUser();if(error||!auth.user)return json(401,{error:'Open your public payment link to continue.'});
   const {data,error:failure}=await userClient.rpc('get_guest_renewal_details',{_period_id:input.periodId});if(failure)return json(403,{error:failure.message});details=data;
   const {data:token,error:tokenError}=await service.rpc('ensure_square_renewal_link',{_period_id:input.periodId});if(tokenError)throw tokenError;link=token;
  }
  await client.cardOnFileReadiness();
  const config={card_on_file_scopes_verified:true,provider:'square',environment:'live',applicationId,locationId:client.location,cof_required:true,terms_version:CARD_TERMS_VERSION,authorization_terms:authorizationTerms(kind==='live_test',Number(details.amount_cents))};
  const context=link?await service.rpc('get_square_checkout_authorization_context',{_kind:kind,_link:link}):{data:{},error:null};if(context.error)throw context.error;
  const latest=async()=>{let q=service.from('square_renewal_payment_attempts').select('*');q=kind==='live_test'?q.eq('test_id',details.test_id):q.eq('period_id',details.period_id);const {data,error}=await q.order('generation',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data as RenewalAttempt|null;};
  const responseDetails=async()=>{
   const out={...details,...config,authorization_context:context.data} as Record<string,unknown>;
   if(input.previewToken)return out;
   const a=await latest();if(a){const c=await authorizationForAttempt(db,a.id);if(c){out.card_saved=c.card_state==='verified';out.future_authorization_active=c.state==='active';out.card_save_pending=a.state==='paid'&&c.card_state!=='verified'&&c.state!=='withdrawn';out.authorization_withdrawn=c.state==='withdrawn';if(input.submissionId===c.submission_id){out.card_last4=c.card_last4;out.setup_retry_allowed=!c.dispatch_started_at&&c.state!=='withdrawn';}}}
   return out;
  };
  if(input.action==='details')return json(200,await responseDetails());
  if(input.previewToken)return json(403,{error:'Inspection cannot submit a payment.'});
  const record=async(a:RenewalAttempt,p:Parameters<typeof squareRenewalEvidence>[0])=>{
   const c=await authorizationForAttempt(db,a.id);if(c&&c.square_customer_id!==(p as typeof p&{customer_id?:string}).customer_id)throw new Error('Square payer identity requires reconciliation.');
   const {error}=await service.rpc('record_square_checkout_payment',squareRenewalEvidence(p,a));if(error)throw error;
   if(p.status==='COMPLETED'&&c){try{await finalizeCheckoutCard(db,client,a,p);}catch{if(c.card_state!=='verified')await service.from('square_checkout_authorizations').update({card_state:'error'}).eq('id',c.id);}}
  };
  const recover=async(a:RenewalAttempt)=>{if(a.location_id!==client.location||a.environment!=='live')throw new Error('Square configuration conflicts. No new payment was started.');const p=a.provider_payment_id?await client.get(a.provider_payment_id):await client.find(a.id,a.created_at);if(p)await record(a,p);};
  if(input.action==='status'){const a=await latest();if(a&&!['failed','canceled'].includes(a.state))await recover(a);}
  else if(input.action==='pay'){
   if(!details.can_pay)return json(409,{error:details.payment_status==='paid'?'This payment has already been confirmed. Do not pay again.':'This payment is not currently payable.'});
   if(input.storageConsent!==true||input.futureConsent!==true||input.termsVersion!==CARD_TERMS_VERSION)return json(400,{error:'Please affirm both card storage and future-charge authorization before paying.'});
   if(typeof input.submissionId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.submissionId))return json(400,{error:'Payment submission identity required.'});
   const payer=validatePayer(input.payer);
   if(typeof input.token!=='string'||!input.token.startsWith('cnon:')||input.token.length>4000)return json(400,{error:'Fresh Square card verification required.'});
   const {data:a,error}=await service.rpc('prepare_square_cof_checkout',{_kind:kind,_link:link,_submission_id:input.submissionId,_payer:payer,_terms_version:CARD_TERMS_VERSION,_terms_text:config.authorization_terms,_terms_context:context.data,_storage_consent:true,_future_consent:true,_location_id:client.location});
   if(error)return json(409,{error:error.message});
   if(!a.already_paid){
    if(!a.dispatch)await recover(a);
    else{
     const c=await authorizationForAttempt(db,a.id);if(!c)throw new Error('Accepted authorization unavailable. No payment was submitted.');
     const customerId=await ensureSquareCustomer(db,client,c);
     const {data:dispatch,error}=await service.rpc('claim_square_cof_dispatch',{_authorization_id:c.id,_submission_id:input.submissionId});if(error)throw error;
     if(!dispatch)await recover(a);
     else{try{
      const payment=await client.create({token:input.token,key:a.id,reference:a.id,amount:a.amount_cents,hold:false,customerId,description:kind==='live_test'?`ZONYX PAY independent LIVE $${(Number(details.amount_cents)/100).toFixed(2)} test`:`ZONYX Rental Renewal | ${details.reservation_number} | ${details.period_start} - ${details.period_end}`});
      await record(a,await client.get(payment.id));
     }catch(error){const {error:saveError}=await service.rpc('record_square_checkout_payment',{_attempt_id:a.id,_payment_id:null,_amount_cents:a.amount_cents,_location_id:a.location_id,_environment:a.environment,_status:error instanceof SquareCardDeclined?'FAILED':'UNKNOWN'});if(saveError)throw saveError;throw error;}}
    }
   }
  }else return json(400,{error:'Unsupported checkout action.'});
  const {data,error}=await service.rpc(kind==='live_test'?'get_square_live_test_details':'get_public_square_renewal_details',{_token:link});if(error)throw error;details=data;
  return json(200,await responseDetails());
 }catch(error){return json(error instanceof SquareCardDeclined?402:400,{error:error instanceof Error?error.message:'Square outcome requires a status check. Do not submit another payment.'});}
});
