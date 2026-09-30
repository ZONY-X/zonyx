import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const respond=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[character]!));
const sha256=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");

async function notify(serviceClient:ReturnType<typeof createClient>,bookingId:string,result:Record<string,unknown>,kind:"operative_amendment"|"acceptance_required"|"accepted_amendment"){
 const{data:booking,error:bookingError}=await serviceClient.from("bookings").select("id,reservation_number,renter_profile_id").eq("id",bookingId).single();
 if(bookingError||!booking)throw new Error("Booking notification recipient is unavailable.");
 const{data:recipient,error:recipientError}=await serviceClient.from("profiles").select("email,full_name").eq("id",booking.renter_profile_id).single();
 if(recipientError||!recipient?.email)throw new Error("Guest email is unavailable.");
 const revisionId=typeof result.revision_id==="string"?result.revision_id:null;const proposalId=typeof result.proposal_id==="string"?result.proposal_id:null;
 const table=revisionId?"rental_agreement_revisions":"rental_agreement_amendment_proposals";const id=revisionId??proposalId;
 const{data:record,error:recordError}=await serviceClient.from(table).select(revisionId?"field_changes,effective_at,revision_number":"field_changes,proposed_effective_at,proposed_revision_number").eq("id",id).single();
 if(recordError||!record)throw new Error("Amendment notification evidence is unavailable.");
 const changes=(record.field_changes as Array<{field:string;from?:string;to?:string}>).map(change=>`${change.field}: ${change.from??"None"} → ${change.to??"None"}`).join("; ");
 const effectiveAt=String(revisionId?record.effective_at:record.proposed_effective_at);const revisionNumber=Number(revisionId?record.revision_number:record.proposed_revision_number);
 const appUrl=(Deno.env.get("APP_PUBLIC_URL")||"https://www.gozonyx.com").replace(/\/$/,"");const agreementUrl=`${appUrl}/booking/${booking.id}/agreement`;
 const acceptanceRequired=kind==="acceptance_required";const subject=acceptanceRequired?`Action required: Rental Agreement amendment for ${booking.reservation_number}`:`Rental Agreement amended — ${booking.reservation_number}`;
 const intro=acceptanceRequired?"A proposed material amendment requires your electronic acceptance before it becomes operative.":kind==="accepted_amendment"?"Your accepted Rental Agreement amendment is now operative.":"An authorized operational amendment is now part of your current operative Rental Agreement.";
 const text=[intro,`Reservation: ${booking.reservation_number}`,`Revision: ${revisionNumber}`,`Effective: ${effectiveAt}`,`Changes: ${changes}`,`View ${acceptanceRequired?"and accept ":""}the current agreement: ${agreementUrl}`].join("\n");
 const html=`<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>${escapeHtml(subject)}</h2><p>${escapeHtml(intro)}</p><p><strong>Reservation:</strong> ${escapeHtml(booking.reservation_number)}<br><strong>Revision:</strong> ${revisionNumber}<br><strong>Effective:</strong> ${escapeHtml(effectiveAt)}</p><p><strong>Changes:</strong> ${escapeHtml(changes)}</p><p><a href="${escapeHtml(agreementUrl)}">View ${acceptanceRequired?"and accept ":""}the Rental Agreement</a></p></div>`;
 const payload={from:Deno.env.get("BOOKING_CONFIRMATION_FROM_EMAIL"),to:[recipient.email],subject,html,text,...(Deno.env.get("BOOKING_CONFIRMATION_REPLY_TO")?{reply_to:Deno.env.get("BOOKING_CONFIRMATION_REPLY_TO")}:{})};
 let status="failed",providerId="",errorMessage="";
 try{const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${Deno.env.get("RESEND_API_KEY")}`,"Content-Type":"application/json","Idempotency-Key":`rental-agreement-amendment/${id}/${kind}`},body:JSON.stringify(payload)});const body=await response.json();if(!response.ok||!body.id)throw new Error(body?.message||body?.error?.message||"Email provider rejected notification.");status="sent";providerId=body.id;}catch(error){errorMessage=error instanceof Error?error.message:"Notification failed.";}
 await serviceClient.rpc("record_rental_agreement_amendment_notification",{_booking_id:booking.id,_revision_id:revisionId,_proposal_id:proposalId,_recipient_email:recipient.email,_notification_type:kind,_provider_message_id:providerId,_status:status,_subject:subject,_payload_hash:await sha256(JSON.stringify(payload)),_error_message:errorMessage});
 return{status,providerMessageId:providerId||null,error:errorMessage||null};
}

serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});if(request.method!=="POST")return respond(405,{error:"Method not allowed."});
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),authorization=request.headers.get("authorization");
  if(!url||!anon||!serviceKey||!authorization)return respond(401,{error:"Authentication required."});
  const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});const serviceClient=createClient(url,serviceKey);const serviceAuthorized=authorization===`Bearer ${serviceKey}`;const{data:userData,error:userError}=serviceAuthorized?{data:{user:null},error:null}:await userClient.auth.getUser();if(!serviceAuthorized&&(userError||!userData.user))return respond(401,{error:"Authentication required."});
  const input=await request.json();
  if(input.action==="notifyRevision"&&serviceAuthorized){
   const{data:revision,error}=await serviceClient.from("rental_agreement_revisions").select("id,booking_id").eq("id",input.revisionId).single();if(error||!revision)return respond(404,{error:"Rental Agreement revision not found."});
   const notification=await notify(serviceClient,revision.booking_id,{revision_id:revision.id},"operative_amendment");return respond(notification.status==="sent"?200:502,{revisionId:revision.id,notification});
  }
  if(input.action==="amend"){
   const{data,error}=await userClient.rpc("admin_amend_rental_agreement",{_booking_id:input.bookingId,_additional_driver_names:input.additionalDriverNames??[],_end_date:input.endDate,_dropoff_time:input.dropoffTime,_pickup_location:input.pickupLocation,_dropoff_location:input.dropoffLocation,_fulfillment_method:input.fulfillmentMethod,_operational_terms:input.operationalTerms??"None",_effective_at:input.effectiveAt,_reason:input.reason});
   if(error)return respond(400,{error:error.message});const result=data as Record<string,unknown>;const notification=await notify(serviceClient,input.bookingId,result,result.requires_customer_acceptance?"acceptance_required":"operative_amendment");return respond(200,{...result,notification});
  }
  if(input.action==="accept"){
   const ip=(request.headers.get("x-forwarded-for")||request.headers.get("cf-connecting-ip")||"").split(",")[0].trim()||null;const agent=request.headers.get("user-agent")||"";
   const{data:proposal}=await serviceClient.from("rental_agreement_amendment_proposals").select("booking_id").eq("id",input.proposalId).single();if(!proposal)return respond(404,{error:"Amendment proposal not found."});
   const{data,error}=await userClient.rpc("accept_rental_agreement_amendment",{_proposal_id:input.proposalId,_document_hash:input.documentHash,_accepted_ip:ip,_accepted_user_agent:agent});if(error)return respond(400,{error:error.message});const result=data as Record<string,unknown>;const notification=await notify(serviceClient,proposal.booking_id,result,"accepted_amendment");return respond(200,{...result,notification});
  }
  return respond(400,{error:"Unsupported action."});
 }catch(error){console.error("rental-agreement-amendments",error);return respond(500,{error:error instanceof Error?error.message:"Unable to process Rental Agreement amendment."});}
});