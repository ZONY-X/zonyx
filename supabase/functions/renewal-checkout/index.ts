import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyRenewalPreview } from '../_shared/renewal-checkout.ts';
import { SquareClient, SquareCardDeclined } from '../_shared/square-client.ts';
import { assertSquareSandbox, squareSetting } from '../_shared/square-policy.ts';
import { squareRenewalEvidence, type RenewalAttempt } from '../_shared/square-renewal.ts';
const env = (name: string) => Deno.env.get(name);
const cors = { 'Access-Control-Allow-Origin': 'https://www.gozonyx.com', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => Response.json(body, {status, headers: cors});
Deno.serve(async request => {
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
 try {
  const url=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
  if(!url||!key||!anon)return json(503,{error:'Renewal checkout unavailable.'});
  const input=await request.json();
  if(!input||Object.keys(input).some(k=>!['action','periodId','previewToken','token'].includes(k)))return json(400,{error:'Unsupported renewal fields.'});
  let details:Record<string,unknown>;
  let userId:string|undefined;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:request.headers.get('authorization')||''}}});
  const service=createClient(url,key);
  if(input.previewToken){
   if(input.action!=='details')return json(403,{error:'Inspection only. No payment can be submitted.'});
   const preview=await verifyRenewalPreview(String(input.previewToken),key);
   details={...preview,preview:true,can_pay:false,payment_status:'payment_due',plan_status:'active'};
  }else{
   const {data:auth,error}=await userClient.auth.getUser();
   if(error||!auth.user)return json(401,{error:'Sign in to review this renewal.'});
   userId=auth.user.id;
   const {data,error:failure}=await userClient.rpc('get_guest_renewal_details',{_period_id:input.periodId});
   if(failure)return json(403,{error:failure.message});details=data;
  }
  assertSquareSandbox(env);
  if(env('SQUARE_ENVIRONMENT')!=='live')return json(503,{error:'Square LIVE renewal checkout is unavailable. No payment was started.'});
  const client=new SquareClient(env);
  const applicationId=squareSetting(env,'APPLICATION_ID');
  if(!applicationId?.startsWith('sq0idp-'))return json(503,{error:'Square LIVE card form configuration unavailable.'});
  const config={provider:'square',environment:'live',applicationId,locationId:client.location};
  if(input.action==='details')return json(200,{...details,...config});
  if(input.previewToken||!userId)return json(403,{error:'Inspection cannot submit a payment.'});
  // Authoritative ownership is checked before any payment claim or provider POST.
  if(input.action==='pay'&&!details.can_pay)return json(403,{error:details.admin_inspection?'Admin inspection only. The Guest submits their own card payment.':'This renewal is not payable.'});
  const record=async(a:RenewalAttempt,p:Parameters<typeof squareRenewalEvidence>[0])=>{const {error}=await service.rpc('record_square_renewal_payment',squareRenewalEvidence(p,a));if(error)throw error;};
  const recover=async(a:RenewalAttempt)=>{
   if(a.location_id!==client.location||a.environment!=='live')throw new Error('Square renewal configuration conflicts. No new payment was started.');
   const p=a.provider_payment_id?await client.get(a.provider_payment_id):await client.find(a.id,a.created_at);
   if(p)await record(a,p);
  };
  if(input.action==='status'){
   const {data:a,error}=await service.from('square_renewal_payment_attempts').select('*').eq('period_id',input.periodId).order('generation',{ascending:false}).limit(1).maybeSingle();
   if(error)throw error;if(a&&!['paid','failed','canceled'].includes(a.state))await recover(a);
  }else if(input.action==='pay'){
   if(typeof input.token!=='string'||!input.token.startsWith('cnon:')||input.token.length>4000)return json(400,{error:'A fresh Square card verification token is required.'});
   const {data:a,error}=await service.rpc('prepare_square_renewal_payment',{_period_id:input.periodId,_user_id:userId,_environment:'live',_location_id:client.location});
   if(error)return json(409,{error:error.message});
   if(!a.already_paid){
    if(!a.dispatch)await recover(a);
    else{
     try{
      // Renewal charge only: no original rental or security-deposit operation.
      const payment=await client.create({token:input.token,key:a.id,reference:a.id,amount:a.amount_cents,hold:false});
      await record(a,await client.get(payment.id));
     }catch(error){
      const {error:saveError}=await service.rpc('record_square_renewal_payment',{_attempt_id:a.id,_payment_id:null,_amount_cents:a.amount_cents,_location_id:a.location_id,_environment:a.environment,_status:error instanceof SquareCardDeclined?'FAILED':'UNKNOWN'});
      if(saveError)throw saveError;
      throw error;
     }
    }
   }
  }else return json(400,{error:'Unsupported renewal action.'});
  const {data,error}=await userClient.rpc('get_guest_renewal_details',{_period_id:input.periodId});
  if(error)throw error;return json(200,{...data,...config});
 }catch(error){const status=error instanceof SquareCardDeclined?402:400;return json(status,{error:error instanceof Error?error.message:'Square renewal outcome needs a status check. Do not submit another payment.'});}
});
