import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[character]!));

serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
 if(request.method!=="POST")return json(405,{error:"Method not allowed."});
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),authorization=request.headers.get("authorization")||"";
  if(!url||!anon||!serviceKey||!authorization)return json(401,{error:"Authentication required."});
  const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});const serviceClient=createClient(url,serviceKey);
  const{data:userData,error:userError}=await userClient.auth.getUser();if(userError||!userData.user)return json(401,{error:"Authentication required."});
  const{data:isAdmin,error:adminError}=await userClient.rpc("current_profile_is_admin");if(adminError||!isAdmin)return json(403,{error:"Authoritative Admin required."});
  const input=await request.json();
  if(input.action==="getSchedule"){
   const{data,error}=await userClient.rpc("get_rental_extension_schedule",{_booking_id:input.bookingId});if(error)return json(400,{error:error.message});return json(200,data);
  }
  if(input.action==="initiatePayment"){
   const stripeSecret=Deno.env.get("STRIPE_SECRET_KEY");if(!stripeSecret)return json(500,{error:"Stripe is not configured."});
   const{data:prepared,error:prepareError}=await userClient.rpc("admin_prepare_renewal_payment",{_period_id:input.periodId});if(prepareError)return json(400,{error:prepareError.message});
   if(prepared.already_paid)return json(200,prepared);
   const params=new URLSearchParams({amount:String(prepared.amount_cents),currency:String(prepared.currency),customer:String(prepared.stripe_customer_id),payment_method:String(prepared.stripe_payment_method_id),confirm:"true",off_session:"true","metadata[bookingId]":String(prepared.booking_id),"metadata[renewalPeriodId]":String(prepared.period_id),"metadata[renewalPaymentAttemptId]":String(prepared.attempt_id)});
   let response:Response;try{response=await fetch("https://api.stripe.com/v1/payment_intents",{method:"POST",headers:{Authorization:`Bearer ${stripeSecret}`,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":String(prepared.idempotency_key)},body:params});}catch(error){await serviceClient.rpc("mark_renewal_payment_reconciliation_required",{_attempt_id:prepared.attempt_id,_failure_code:error instanceof Error?error.message:"stripe_network_error"});return json(502,{error:"Stripe response is unknown. Retry this same renewal period; the stable idempotency key prevents a duplicate PaymentIntent.",recoveryRequired:true,attemptId:prepared.attempt_id});}
   const body=await response.json();const succeeded=response.ok&&body.status==="succeeded";
   const{data:finalized,error:finalizeError}=await serviceClient.rpc("finalize_renewal_payment",{_attempt_id:prepared.attempt_id,_stripe_payment_intent_id:body.id||prepared.existing_payment_intent_id||`stripe_error_${prepared.attempt_id}`,_succeeded:succeeded,_failure_code:succeeded?null:String(body?.error?.code||body.status||`http_${response.status}`)});
   if(finalizeError)return json(502,{error:"Stripe responded, but renewal persistence requires reconciliation. Retry this same period; the stable idempotency key prevents a duplicate PaymentIntent.",recoveryRequired:true,attemptId:prepared.attempt_id});
   if(!succeeded)return json(402,{error:body?.error?.message||"Renewal payment was not completed.",periodId:prepared.period_id,attemptId:prepared.attempt_id,paymentIntentId:body.id||null});
   return json(200,{...finalized,amountCents:prepared.amount_cents});
  }
  if(input.action==="sendReminder"){
   const{data:period,error:periodError}=await serviceClient.from("rental_extension_periods").select("id,booking_id,period_start,period_end,amount_due_cents,currency,billing_reminder_date,communication_enabled,notification_status").eq("id",input.periodId).single();
   if(periodError||!period)return json(404,{error:"Renewal period not found."});if(!period.communication_enabled)return json(400,{error:"Guest communication is disabled for this renewal period."});if(period.notification_status==="sent")return json(200,{alreadySent:true,periodId:period.id});
   const{data:booking}=await serviceClient.from("bookings").select("id,reservation_number,renter_profile_id").eq("id",period.booking_id).single();const{data:guest}=await serviceClient.from("profiles").select("email,full_name").eq("id",booking.renter_profile_id).single();if(!booking||!guest?.email)return json(400,{error:"Guest reminder recipient is unavailable."});
   const subject=`Rental renewal due — ${booking.reservation_number}`;const amount=new Intl.NumberFormat("en-US",{style:"currency",currency:String(period.currency).toUpperCase()}).format(Number(period.amount_due_cents)/100);const text=`Rental renewal payment is due.\nReservation: ${booking.reservation_number}\nPeriod: ${period.period_start} → ${period.period_end}\nAmount due: ${amount}\nBilling/reminder date: ${period.billing_reminder_date}`;const html=`<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>${escapeHtml(subject)}</h2><p>Rental renewal payment is due.</p><p><strong>Reservation:</strong> ${escapeHtml(booking.reservation_number)}<br><strong>Period:</strong> ${escapeHtml(period.period_start)} → ${escapeHtml(period.period_end)}<br><strong>Amount due:</strong> ${escapeHtml(amount)}<br><strong>Billing/reminder date:</strong> ${escapeHtml(period.billing_reminder_date)}</p></div>`;
   const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${Deno.env.get("RESEND_API_KEY")}`,"Content-Type":"application/json","Idempotency-Key":`rental-renewal-reminder/${period.id}`},body:JSON.stringify({from:Deno.env.get("BOOKING_CONFIRMATION_FROM_EMAIL"),to:[guest.email],subject,text,html,...(Deno.env.get("BOOKING_CONFIRMATION_REPLY_TO")?{reply_to:Deno.env.get("BOOKING_CONFIRMATION_REPLY_TO")}:{})})});const body=await response.json();const sent=response.ok&&Boolean(body.id);
   await serviceClient.rpc("record_renewal_reminder_result",{_period_id:period.id,_sent:sent,_provider_message_id:body.id||"",_error_message:sent?"":String(body?.message||body?.error?.message||`http_${response.status}`)});
   if(!sent)return json(502,{error:"Renewal reminder delivery failed and was recorded.",periodId:period.id});return json(200,{periodId:period.id,providerMessageId:body.id});
  }
  return json(400,{error:"Unsupported action."});
 }catch(error){console.error("rental-extension-actions",error);return json(500,{error:error instanceof Error?error.message:"Unable to process rental extension action."});}
});