import { supabase } from "@/integrations/supabase/client";
export async function squareAction(input: {action:string;bookingId?:string;agreementId?:string;paymentId?:string;token?:string;reason?:string}, operations = false) {
  const {data:session}=await supabase.auth.getSession();
  if(!session.session) throw new Error("Sign in to continue to secure checkout.");
  let response:Response;
  try {
    response=await fetch(new URL(`/functions/v1/${operations ? "square-booking-operations" : "square-checkout"}`,import.meta.env.VITE_SUPABASE_URL),{
      method:"POST",headers:{Authorization:`Bearer ${session.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},
      body:JSON.stringify(input),signal:AbortSignal.timeout(30000),
    });
  } catch {throw new Error("Payment outcome requires reconciliation. Check the existing payment before retrying or switching providers.");}
  const data=await response.json();
  if(!response.ok)throw new Error(typeof data.error === "string" ? data.error.replace(/\b(Square|PayPal)\b/g, "payment processor") : "Check the existing payment before retrying.");
  return data;
}
