// Non-financial diagnostic, exact isolated sandbox and synthetic tester only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PayPalClient } from "../_shared/paypal-client.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import { authenticate, corsHeaders, env, json, paymentFailure, serviceClient, validateBooking, type Payment } from "../_shared/payment-service.ts";
serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
 try {
  if(request.method!=='POST')throw new PaymentError(405,'Method not allowed.');
  if(env('SUPABASE_URL')!=='https://pvowzjqimikcoyjwclez.supabase.co'||env('PAYPAL_ENVIRONMENT')!=='sandbox')throw new PaymentError(403,'Exact sandbox required.');
  const user=await authenticate(request);
  if(user.id!=='52af03eb-1976-4db0-900a-6509b1c8405b')throw new PaymentError(403,'Synthetic tester required.');
  const input=await request.json();
  if(Object.keys(input).some(k=>!['paymentId','action'].includes(k))||typeof input.paymentId!=='string'||(input.action&&input.action!=='inspect'))throw new PaymentError(400,'Existing payment only.');
  const db=serviceClient();const {data:p,error}=await db.from('booking_payments').select('*').eq('id',input.paymentId).eq('provider','paypal').eq('environment','sandbox').maybeSingle();
  if(error||!p)throw new PaymentError(404,'Synthetic payment required.');
  await validateBooking(db,p.booking_id,p.agreement_id,user.id,true);
  const {data:op,error:opError}=await db.from('paypal_booking_operations').select('*').eq('payment_id',p.id).maybeSingle();
  if(opError||!op?.provider_refund_id||!p.capture_id)throw new PaymentError(409,'Verified existing refund required.');
  const paypal=new PayPalClient(env);const start=new Date(op.created_at);if(Date.now()-start.getTime()>3*86400000)throw new PaymentError(409,'Diagnostic window expired.');
  const query=new URLSearchParams({event_type:'PAYMENT.CAPTURE.REFUNDED',start_time:start.toISOString().replace(/\.\d{3}Z$/,'Z'),end_time:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),page_size:'20'});
  const events=await paypal.request<{events?:{id:string;event_type:string;resource?:{id:string}}[]}>(`/v1/notifications/webhooks-events?${query}`);
  const matches=(events.events||[]).filter(e=>e.event_type==='PAYMENT.CAPTURE.REFUNDED'&&e.resource?.id===op.provider_refund_id);
  if(matches.length!==1||!env('PAYPAL_WEBHOOK_ID'))throw new PaymentError(409,'One exact app refund event is required.');
  if(input.action==='inspect') {
    const event=await paypal.request<{status?:string;transmissions?:{status?:string;http_status?:number;reason_for_failure?:string}[]}>(`/v1/notifications/webhooks-events/${encodeURIComponent(matches[0].id)}`);
    return json(200,{eventId:matches[0].id,status:event.status,transmissions:event.transmissions?.map(t=>({status:t.status,httpStatus:t.http_status,reason:t.reason_for_failure}))});
  }
  // Requests another signed notification; never repeats a refund, void or capture.
  await paypal.request(`/v1/notifications/webhooks-events/${encodeURIComponent(matches[0].id)}/resend`,{webhook_ids:[env('PAYPAL_WEBHOOK_ID')]});
  return json(200,{redeliveryRequested:true,eventId:matches[0].id,paymentId:(p as Payment).id});
 }catch(error){return paymentFailure(error);}
});
