import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PayPalClient } from "../_shared/paypal-client.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import { authenticate, corsHeaders, env, json, type Payment, paymentFailure, rpc, serviceClient } from "../_shared/payment-service.ts";
import { type Deposit } from "../_shared/paypal-deposit.ts";
import { type CancellationOperation, executeCancellation } from "../_shared/paypal-operations.ts";
serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
 if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
 try {
  const sandbox=env('PAYPAL_ENVIRONMENT')==='sandbox' && env('SUPABASE_URL')==='https://pvowzjqimikcoyjwclez.supabase.co';
  const live=env('PAYPAL_ENVIRONMENT')==='live' && env('SUPABASE_URL')==='https://fazzuetfwwfiqehpnjky.supabase.co' && env('PAYPAL_CUSTOMER_RELEASE_VERIFIED')==='true' && env('PAYPAL_LIVE_OPERATIONS_ENABLED')==='true';
  if(env('PAYPAL_BOOKING_OPERATIONS_ENABLED')!=='true' || (!sandbox && !live)) throw new PaymentError(503,'PayPal booking operations are disabled.');
  const user=await authenticate(request,true),input=await request.json();
  if(!input || Object.keys(input).some(k=>!['action','paymentId','reason'].includes(k)) || !['cancel','status','release'].includes(input.action) || typeof input.paymentId!=='string')throw new PaymentError(400,'Only an existing payment and cancellation reason are accepted.');
  const db=serviceClient();
  const {data:p,error:pError}=await db.from('booking_payments').select('*').eq('id',input.paymentId).eq('provider','paypal').maybeSingle();
  if(pError)throw new PaymentError(503,'Payment lookup unavailable.');
  if(!p || p.environment!==env('PAYPAL_ENVIRONMENT'))throw new PaymentError(404,'Payment not found.');
  // Authoritative profile flags, never editable JWT user_metadata or role input.
  const {data:g,error:gError}=await db.from('profiles').select('id,is_admin').eq('user_id',user.id).maybeSingle();
  const {data:b,error:bError}=await db.from('bookings').select('renter_profile_id,host_profile_id').eq('id',p.booking_id).maybeSingle();
  if(gError||bError)throw new PaymentError(503,'Booking access lookup unavailable.');
  if(!g || !b || !(g.is_admin || [b.renter_profile_id,b.host_profile_id].includes(g.id)))throw new PaymentError(404,'Booking not found.');
  let operation:CancellationOperation;
  if(input.action==='release')operation=await rpc(db,'prepare_paypal_deposit_return_release',{_payment_id:p.id,_user_id:user.id,_reason:input.reason});
  else if(input.action==='cancel')operation=await rpc(db,'prepare_paypal_cancellation',{_payment_id:p.id,_user_id:user.id,_reason:input.reason});
  else {
   const result=await db.from('paypal_booking_operations').select('*').eq('payment_id',p.id).maybeSingle();
   if(result.error)throw new PaymentError(503,'Operation lookup unavailable.');
   if(!result.data)throw new PaymentError(409,'No existing cancellation to reconcile.');
   operation=result.data as CancellationOperation;
  }
  const {data:d,error:dError}=await db.from('booking_security_deposits').select('*').eq('rental_payment_id',p.id).eq('generation',1).maybeSingle();
  if(dError||!d)throw new PaymentError(409,'Deposit evidence unavailable; no provider write was sent.');
  return json(200,await executeCancellation(db,new PayPalClient(env),p as Payment,operation,d as Deposit,input.action!=='status'));
 }catch(error){return paymentFailure(error);}
});
