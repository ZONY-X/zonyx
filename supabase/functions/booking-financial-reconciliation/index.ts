import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeReconciliation, buildReconciliationProposal, parseReconciliationInput, proposalFingerprintPayload, summarizeEntries } from "../_shared/booking-financial-reconciliation.ts";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
async function fingerprint(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");}

serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return json(405,{code:"METHOD_NOT_ALLOWED",error:"Method not allowed."});
  try{
    const auth=req.headers.get("authorization")||"";if(!auth)return json(401,{code:"AUTH_REQUIRED",error:"Authentication required."});
    const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!anon||!service)return json(500,{code:"CONFIGURATION_ERROR",error:"Server configuration is incomplete."});
    const input=parseReconciliationInput(await req.json());if(!input)return json(400,{code:"INVALID_INPUT",error:"A valid reconciliation request is required."});
    const userClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
    const{data:userData,error:userError}=await userClient.auth.getUser();if(userError||!userData.user)return json(401,{code:"AUTH_EXPIRED",error:"Session is invalid or expired."});
    const{data:caps,error:capsError}=await userClient.rpc("get_my_account_capabilities");const capability=Array.isArray(caps)?caps[0]:caps;
    const access=authorizeReconciliation(true,!capsError&&capability?.can_admin===true);if(!access.allowed)return json(access.status,{code:"ADMIN_REQUIRED",error:"Authoritative Admin access required."});
    const{data:booking,error:bookingError}=await userClient.from("bookings").select("id,reservation_number,subtotal_cents,service_fee_cents,taxes_cents,grand_total_cents,currency,created_at,start_date,pickup_time,end_date,dropoff_time,trip_status").eq("id",input.bookingId).maybeSingle();
    if(bookingError||!booking)return json(404,{code:"BOOKING_NOT_FOUND",error:"Booking not found."});
    const inspect=await fetch(`${url}/functions/v1/stripe-financial-inspector`,{method:"POST",headers:{Authorization:auth,apikey:anon,"Content-Type":"application/json"},body:JSON.stringify({booking_id:input.bookingId})});
    const snapshot=await inspect.json();if(!inspect.ok)return json(inspect.status,{code:"STRIPE_INSPECTION_FAILED",error:"A fresh read-only Stripe snapshot could not be prepared.",inspector_code:snapshot?.code});
    const ambiguous=new Set((snapshot.security_deposit_attempts?.timeline||[]).filter((x:any)=>x.association?.confidence==="AMBIGUOUS").map((x:any)=>x.payment_intent_id));
    if(input.approved.some(id=>!ambiguous.has(id)))return json(400,{code:"INVALID_AMBIGUOUS_APPROVAL",error:"An approved PaymentIntent is not an ambiguous candidate in the fresh Stripe snapshot."});
    const proposal=buildReconciliationProposal(snapshot,booking,input.approved);const summary=summarizeEntries(proposal.entries);const proposalFingerprint=await fingerprint(proposalFingerprintPayload(proposal.entries,input.approved));
    const preview={booking:{id:booking.id,reservation_number:booking.reservation_number},current_zonyx:booking,stripe_evidence:{checkout_total_cents:snapshot.checkout?.amount_total??null,rental_payment_received_cents:snapshot.rental_payment?.amount_received??null,deposit_attempts:snapshot.security_deposit_attempts},proposed_ledger:proposal.entries,proposed_summary:summary,excluded_ambiguous:proposal.excluded_ambiguous,observed_at:snapshot.observed_at,proposal_fingerprint:proposalFingerprint};
    if(input.action==="prepare")return json(200,{preview});
    if(input.reason.length<5||!input.idempotencyKey||input.proposalFingerprint!==proposalFingerprint)return json(409,{code:"PREVIEW_CHANGED",error:"Stripe evidence or selections changed. Prepare and review a new preview before confirming."});
    const serviceClient=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const{data:reconciliationId,error:persistError}=await serviceClient.rpc("persist_booking_financial_reconciliation",{_booking_id:booking.id,_idempotency_key:input.idempotencyKey,_reason:input.reason,_source_observed_at:snapshot.observed_at,_source_snapshot:snapshot,_before_state:booking,_approved_ambiguous_ids:input.approved,_actor_profile_id:capability.profile_id,_entries:proposal.entries});
    if(persistError)return json(500,{code:"PERSISTENCE_FAILED",error:"Unable to persist the reconciliation audit."});
    return json(200,{reconciliation_id:reconciliationId,summary,idempotent:true});
  }catch{return json(500,{code:"INTERNAL_ERROR",error:"Unable to prepare financial reconciliation."});}
});