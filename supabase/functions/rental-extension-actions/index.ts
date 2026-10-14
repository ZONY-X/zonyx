import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { renewalReminderEmail } from "../_shared/renewal-email.ts";
import { RENEWAL_ORIGIN } from "../_shared/renewal-checkout.ts";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});

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
  if(input.action==="getPaymentLink"){
   const{data:token,error}=await serviceClient.rpc("ensure_square_renewal_link",{_period_id:input.periodId});
   if(error)return json(400,{error:error.message});
   return json(200,{url:`${RENEWAL_ORIGIN}/booking/renewal?link=${encodeURIComponent(token)}`});
  }
  if(input.action==="initiatePayment")return json(409,{error:"Renewals are paid by the Guest through Square. Open the renewal payment page to inspect it; no stored card is charged by Admin."});
  if(input.action==="sendReminder" || input.action==="sendTestReminder"){
   const preview=input.action==="sendTestReminder";
   const{data:period,error:periodError}=await serviceClient.from("rental_extension_periods").select("id,booking_id,period_start,period_end,amount_due_cents,currency,billing_reminder_date,communication_enabled,notification_status,payment_status,extension_plan_id").eq("id",input.periodId).single();
   if(periodError||!period)return json(404,{error:"Renewal period not found."});
   if(period.payment_status==="paid")return json(409,{error:"This renewal period is already paid."});
   if(!preview&&!period.communication_enabled)return json(400,{error:"Guest communication is disabled for this renewal period."});
   if(!preview&&period.notification_status==="sent")return json(200,{alreadySent:true,periodId:period.id});
   const{data:plan}=await serviceClient.from("rental_extension_plans").select("status").eq("id",period.extension_plan_id).single();
   if(!preview&&plan?.status!=="active")return json(409,{error:"Activate this extension before requesting payment from the Guest."});
   const{data:booking}=await serviceClient.from("bookings").select("id,reservation_number,renter_profile_id").eq("id",period.booking_id).single();
   if(!booking)return json(404,{error:"Reservation unavailable."});
   const{data:guest}=await serviceClient.from("profiles").select("email").eq("id",booking.renter_profile_id).single();
   const recipient=preview?userData.user.email:guest?.email;
   if(!recipient)return json(400,{error:"Reminder recipient unavailable."});
   const{data:linkToken,error:linkError}=await serviceClient.rpc("ensure_square_renewal_link",{_period_id:period.id});
   if(linkError||!linkToken)return json(503,{error:"Public payment link unavailable."});
   const paymentUrl=`${RENEWAL_ORIGIN}/booking/renewal?link=${encodeURIComponent(linkToken)}`;
   const email=renewalReminderEmail({reservationNumber:booking.reservation_number,periodStart:period.period_start,periodEnd:period.period_end,amountCents:Number(period.amount_due_cents),currency:period.currency,reminderDate:period.billing_reminder_date,paymentUrl});
   const resendKey=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("BOOKING_CONFIRMATION_FROM_EMAIL");
   if(!resendKey||!from)return json(503,{error:"Email delivery is not configured."});
   const requestId=String(input.requestId||"");
   if(preview&&!/^[a-f0-9-]{36}$/i.test(requestId))return json(400,{error:"Preview request identity required."});
   const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json","Idempotency-Key":preview?`renewal-preview/${period.id}/${requestId}`:`rental-renewal-reminder/${period.id}`},body:JSON.stringify({from,to:[recipient],...email,...(Deno.env.get("BOOKING_CONFIRMATION_REPLY_TO")?{reply_to:Deno.env.get("BOOKING_CONFIRMATION_REPLY_TO")}:{})})});
   const body=await response.json();const sent=response.ok&&Boolean(body.id);
   if(!preview)await serviceClient.rpc("record_renewal_reminder_result",{_period_id:period.id,_sent:sent,_provider_message_id:body.id||"",_error_message:sent?"":String(body?.message||body?.error?.message||`http_${response.status}`)});
   if(!sent)return json(502,{error:"Reminder delivery failed.",periodId:period.id});
   return json(200,{periodId:period.id,providerMessageId:body.id,recipient,preview});
  }
  return json(400,{error:"Unsupported action."});
 }catch(error){console.error("rental-extension-actions",error);return json(500,{error:error instanceof Error?error.message:"Unable to process rental extension action."});}
});