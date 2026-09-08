import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeInspector, buildFinancialSnapshot, parseInspectorInput, type StripeObject } from "../_shared/stripe-financial-snapshot.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Architectural read-only boundary: every Stripe request is GET and this helper
// rejects any path outside the explicitly allowed retrieval/list families.
async function stripeGet(secret: string, path: string): Promise<StripeObject> {
  if (!/^\/(checkout\/sessions|payment_intents|charges|refunds)(\/|\?)/.test(path)) throw new Error("Unsupported Stripe read path.");
  const response = await fetch(`https://api.stripe.com/v1${path}`, { method: "GET", headers: { Authorization: `Bearer ${secret}` } });
  if (!response.ok) throw new Error(`Stripe retrieval failed (${response.status}).`);
  return response.json();
}

const idOf = (value: unknown) => typeof value === "string" ? value : typeof value === "object" && value !== null && typeof (value as StripeObject).id === "string" ? (value as StripeObject).id as string : null;
const expandedOrGet = async (secret: string, value: unknown, family: "payment_intents" | "charges") => {
  if (typeof value === "object" && value !== null) return value as StripeObject;
  const id = idOf(value);
  return id ? stripeGet(secret, `/${family}/${encodeURIComponent(id)}?expand[]=payment_method&expand[]=latest_charge`) : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const authHeader = req.headers.get("authorization") || "";
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!stripeSecret || !supabaseUrl || !anonKey) throw new Error("Server configuration is incomplete.");
    if (!authHeader) return json(401, { error: authorizeInspector(false, false).error });
    const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) return json(401, { error: "Invalid auth session." });
    const { data: isAdmin, error: adminError } = await supabase.rpc("current_profile_is_admin");
    if (adminError) throw adminError;
    const access = authorizeInspector(true, isAdmin === true);
    if (!access.allowed) return json(access.status, { error: access.error });
    const parsed = parseInspectorInput(await req.json());
    if (!parsed.ok) return json(400, { error: parsed.error });

    const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, reservation_number, stripe_checkout_session_id, stripe_payment_intent_id, authorization_hold_payment_intent_id, stripe_refund_id").eq("id", parsed.bookingId).maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) return json(404, { error: "Booking not found." });

    const checkout = booking.stripe_checkout_session_id ? await stripeGet(stripeSecret, `/checkout/sessions/${encodeURIComponent(booking.stripe_checkout_session_id)}?expand[]=payment_intent&expand[]=customer&expand[]=total_details.breakdown.discounts.discount`) : null;
    const lineItemsResult = booking.stripe_checkout_session_id ? await stripeGet(stripeSecret, `/checkout/sessions/${encodeURIComponent(booking.stripe_checkout_session_id)}/line_items?limit=100`) : null;
    const lineItems = Array.isArray(lineItemsResult?.data) ? lineItemsResult.data as StripeObject[] : [];
    const rentalPaymentIntent = await expandedOrGet(stripeSecret, booking.stripe_payment_intent_id || checkout?.payment_intent, "payment_intents");
    const rentalCharge = await expandedOrGet(stripeSecret, rentalPaymentIntent?.latest_charge, "charges");
    const rentalPiId = idOf(rentalPaymentIntent);
    const refundResult = rentalPiId ? await stripeGet(stripeSecret, `/refunds?payment_intent=${encodeURIComponent(rentalPiId)}&limit=100`) : null;
    const refunds = Array.isArray(refundResult?.data) ? refundResult.data as StripeObject[] : [];
    const depositPaymentIntent = await expandedOrGet(stripeSecret, booking.authorization_hold_payment_intent_id, "payment_intents");
    const depositCharge = await expandedOrGet(stripeSecret, depositPaymentIntent?.latest_charge, "charges");

    return json(200, buildFinancialSnapshot({ booking, checkout, lineItems, rentalPaymentIntent, rentalCharge, refunds, depositPaymentIntent, depositCharge, observedAt: new Date().toISOString() }));
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : "Unable to inspect Stripe state." });
  }
});