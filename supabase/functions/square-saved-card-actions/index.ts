import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {SquareClient,SquareCardDeclined} from '../_shared/square-client.ts';
import {assertSquareSandbox} from '../_shared/square-policy.ts';
import {squareRenewalEvidence,type RenewalAttempt} from '../_shared/square-renewal.ts';
import {merchantInitiatedPaymentInput,type Authorization} from '../_shared/square-card-authorization.ts';
const env=(name:string)=>Deno.env.get(name);
const headers={'Access-Control-Allow-Origin':'https://www.gozonyx.com','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const json=(status:number,data:unknown)=>Response.json(data,{status,headers});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
 try{
  const url=env('SUPABASE_URL')!,anon=env('SUPABASE_ANON_KEY')!,key=env('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:request.headers.get('authorization')||''}}});
  const {data:auth,error:authError}=await userClient.auth.getUser();if(authError||!auth.user)return json(401,{error:'Admin authentication required.'});
  const {data:admin,error:adminError}=await userClient.rpc('current_profile_is_admin');if(adminError||!admin)return json(403,{error:'Authoritative Admin required.'});
  const input=await request.json();if(Object.keys(input).some(k=>!['action','authorizationId','periodId','confirm'].includes(k)))return json(400,{error:'Unsupported saved-card fields.'});
  if(!['eligibility','chargeRenewal'].includes(input.action))return json(400,{error:'Unsupported saved-card action.'});
  assertSquareSandbox(env);if(env('SQUARE_ENVIRONMENT')!=='live')return json(503,{error:'LIVE Square required.'});
  const db=createClient(url,key),client=new SquareClient(env);
  const {data:consent,error}=await db.from('square_checkout_authorizations').select('*').eq('id',input.authorizationId).single();
  if(error||!consent)return json(404,{error:'Authorization not found.'});
  const c=consent as Authorization;
  if(c.state!=='active'||c.card_state!=='verified'||c.withdrawn_at||!c.square_card_id||!c.square_customer_id)return json(409,{error:'Active, verified card and future-charge authorization required.'});
  const card=await client.getCard(c.square_card_id),customer=await client.getCustomer(c.square_customer_id);
  if(card.id!==c.square_card_id||!card.enabled||card.customer_id!==c.square_customer_id||card.reference_id!==c.id||customer.id!==c.square_customer_id||customer.reference_id!==c.id)return json(409,{error:'Square card/customer confirmation conflicts.'});
  const {data:initial,error:initialError}=await db.from('square_renewal_payment_attempts').select('*').eq('id',c.attempt_id).single();
  if(initialError||initial.state!=='paid')return json(409,{error:'Confirmed original checkout required.'});
  const original=await client.get(initial.provider_payment_id);squareRenewalEvidence(original,initial as RenewalAttempt);if(original.status!=='COMPLETED'||(original as typeof original&{customer_id?:string}).customer_id!==c.square_customer_id)return json(409,{error:'Original Square payment is not confirmed for this customer.'});
  if(input.action==='eligibility')return json(200,{squareCardConfirmed:true,squareCustomerConfirmed:true,authorizationRecorded:true,merchantInitiatedRequestSupported:true,renewalCollectionAllowed:Boolean(c.booking_id),independentTest:Boolean(c.test_id),financialActionExecuted:false,consentId:c.id,paymentId:original.id,amountCents:initial.amount_cents,squareCustomerId:c.square_customer_id,squareCardId:c.square_card_id,acceptedAt:c.accepted_at});
  if(input.confirm!==true)return json(400,{error:'Explicit confirmation required for exactly one due renewal obligation.'});
  const {data:a,error:prepareError}=await db.rpc('prepare_square_authorized_renewal',{_authorization_id:c.id,_period_id:input.periodId,_admin_user_id:auth.user.id,_location_id:client.location});
  if(prepareError)return json(409,{error:prepareError.message});
  if(a.already_paid)return json(200,{alreadyPaid:true});
  let payment;
  if(a.dispatch){
   try{payment=await client.create(merchantInitiatedPaymentInput(a,c));}
   catch(error){const{error:saveError}=await db.rpc('record_square_checkout_payment',{_attempt_id:a.id,_payment_id:null,_amount_cents:a.amount_cents,_location_id:a.location_id,_environment:a.environment,_status:error instanceof SquareCardDeclined?'FAILED':'UNKNOWN'});if(saveError)throw saveError;throw error;}
  }else payment=a.provider_payment_id?await client.get(a.provider_payment_id):await client.find(a.id,a.created_at);
  if(!payment)return json(409,{error:'Existing payment outcome requires reconciliation. No second charge was sent.'});
  const canonical=await client.get(payment.id);
  if((canonical as typeof canonical&{customer_id?:string}).customer_id!==c.square_customer_id)throw new Error('Canonical payer mismatch.');
  const {data:result,error:recordError}=await db.rpc('record_square_checkout_payment',squareRenewalEvidence(canonical,a as RenewalAttempt));if(recordError)throw recordError;
  return json(200,result);
 }catch(error){return json(error instanceof SquareCardDeclined?402:409,{error:error instanceof Error?error.message:'Square outcome requires reconciliation. Do not submit another payment.'});}
});
