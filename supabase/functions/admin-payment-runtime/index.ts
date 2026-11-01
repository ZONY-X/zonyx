import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, env, json, paymentFailure, serviceClient } from "../_shared/payment-service.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import { managePaymentRuntime } from "../_shared/payment-runtime.ts";
serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const client = createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: request.headers.get("authorization") || "" } }, auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new PaymentError(401, "Sign in to continue.");
    const { data: admin, error: adminError } = await client.rpc("current_profile_is_admin");
    if (adminError || admin !== true) throw new PaymentError(403, "Authoritative Admin required.");
    const input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new PaymentError(400, "Invalid request.");
    return json(200, await managePaymentRuntime(serviceClient(), env, data.user.id, true, input));
  } catch (error) { return paymentFailure(error); }
});
