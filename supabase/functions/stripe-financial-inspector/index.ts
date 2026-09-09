import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeInspector, buildFinancialSnapshot, classifyDepositAttempt, normalizeDepositAttempt, parseInspectorInput, stripeRetrievePath, type StripeObject } from "../_shared/stripe-financial-snapshot.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Architectural read-only boundary: every Stripe request is GET and this helper
// rejects any path outside the explicitly allowed retrieval/list families.
class InspectorError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}

async function stripeGet(secret: string, path: string, code: string): Promise<StripeObject> {
  if (!/^\/(checkout\/sessions|payment_intents|charges|refunds|events|balance_transactions)(\/|\?)/.test(path)) throw new Error("Unsupported Stripe read path.");
  const response = await fetch(`https://api.stripe.com/v1${path}`, { method: "GET", headers: { Authorization: `Bearer ${secret}` } });
  if (!response.ok) {
    const failureCode = response.status === 404 ? "STRIPE_OBJECT_NOT_FOUND" : code;
    throw new InspectorError(failureCode, `Stripe read failed at ${code.replace(/^STRIPE_|_READ_FAILED$/g, "").toLowerCase().replace(/_/g, " ")}.`, response.status === 404 ? 404 : 502);
  }
  return response.json();
}

const idOf = (value: unknown) => typeof value === "string" ? value : typeof value === "object" && value !== null && typeof (value as StripeObject).id === "string" ? (value as StripeObject).id as string : null;
const listData = (value: StripeObject | null) => Array.isArray(value?.data) ? value.data as StripeObject[] : [];
const expandedOrGet = async (secret: string, value: unknown, family: "payment_intents" | "charges", code: string, optional = false) => {
  if (typeof value === "object" && value !== null) return value as StripeObject;
  const id = idOf(value);
  if (!id) return null;
  try { return await stripeGet(secret, stripeRetrievePath(family, id), code); }
  catch (error) { if (optional && error instanceof InspectorError && error.status === 404) return null; throw error; }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const authHeader = req.headers.get("authorization") || "";
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!stripeSecret) return json(500, { code: "STRIPE_SECRET_UNAVAILABLE", error: "Stripe read configuration is unavailable." });
    if (!supabaseUrl || !anonKey) return json(500, { code: "INTERNAL_READ_ERROR", error: "Server configuration is incomplete." });
    if (!authHeader) return json(401, { code: "AUTH_SESSION_MISSING", error: authorizeInspector(false, false).error });
    const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) return json(401, { code: "AUTH_SESSION_EXPIRED", error: "The authenticated session is invalid or expired." });
    const { data: isAdmin, error: adminError } = await supabase.rpc("current_profile_is_admin");
    if (adminError) return json(500, { code: "ADMIN_AUTHORIZATION_FAILED", error: "Unable to verify authoritative Admin access." });
    const access = authorizeInspector(true, isAdmin === true);
    if (!access.allowed) return json(access.status, { code: "ADMIN_AUTHORIZATION_FAILED", error: access.error });
    const parsed = parseInspectorInput(await req.json());
    if (!parsed.ok) return json(400, { error: parsed.error });

    const { data: booking, error: bookingError } = await supabase.from("bookings").select("id, reservation_number, stripe_checkout_session_id, stripe_customer_id, stripe_payment_intent_id, authorization_hold_payment_intent_id, authorization_hold_amount_cents, created_at, end_date").eq("id", parsed.bookingId).maybeSingle();
    if (bookingError) return json(500, { code: "INTERNAL_READ_ERROR", error: "Unable to read the booking." });
    if (!booking) return json(404, { code: "BOOKING_NOT_FOUND", error: "Booking not found." });

    const checkout = booking.stripe_checkout_session_id ? await stripeGet(stripeSecret, `/checkout/sessions/${encodeURIComponent(booking.stripe_checkout_session_id)}?expand[]=payment_intent&expand[]=customer&expand[]=total_details.breakdown.discounts.discount`, "STRIPE_CHECKOUT_READ_FAILED") : null;
    const lineItemsResult = booking.stripe_checkout_session_id ? await stripeGet(stripeSecret, `/checkout/sessions/${encodeURIComponent(booking.stripe_checkout_session_id)}/line_items?limit=100`, "STRIPE_CHECKOUT_READ_FAILED") : null;
    const lineItems = Array.isArray(lineItemsResult?.data) ? lineItemsResult.data as StripeObject[] : [];
    const rentalPaymentIntent = await expandedOrGet(stripeSecret, booking.stripe_payment_intent_id || checkout?.payment_intent, "payment_intents", "STRIPE_PAYMENT_INTENT_READ_FAILED");
    const rentalCharge = await expandedOrGet(stripeSecret, rentalPaymentIntent?.latest_charge, "charges", "STRIPE_CHARGE_READ_FAILED", true);
    const rentalPiId = idOf(rentalPaymentIntent);
    const refundResult = rentalPiId ? await stripeGet(stripeSecret, `/refunds?payment_intent=${encodeURIComponent(rentalPiId)}&limit=100`, "STRIPE_REFUND_READ_FAILED") : null;
    const refunds = Array.isArray(refundResult?.data) ? refundResult.data as StripeObject[] : [];
    const depositPaymentIntent = await expandedOrGet(stripeSecret, booking.authorization_hold_payment_intent_id, "payment_intents", "STRIPE_DEPOSIT_READ_FAILED");
    const depositCharge = await expandedOrGet(stripeSecret, depositPaymentIntent?.latest_charge, "charges", "STRIPE_CHARGE_READ_FAILED", true);
    const depositPiId = idOf(depositPaymentIntent);
    const depositChargeId = idOf(depositCharge);
    const depositRefundResult = depositPiId ? await stripeGet(stripeSecret, `/refunds?payment_intent=${encodeURIComponent(depositPiId)}&limit=100`, "STRIPE_REFUND_READ_FAILED") : null;
    const depositRefunds = Array.isArray(depositRefundResult?.data) ? depositRefundResult.data as StripeObject[] : [];
    const balanceResult = depositChargeId ? await stripeGet(stripeSecret, `/balance_transactions?source=${encodeURIComponent(depositChargeId)}&limit=100`, "STRIPE_BALANCE_READ_FAILED") : null;
    const depositBalanceTransactions = Array.isArray(balanceResult?.data) ? balanceResult.data as StripeObject[] : [];
    const bookingCreatedSeconds = Math.floor(new Date(booking.created_at).getTime() / 1000);
    const eventTypes = ["payment_intent.amount_capturable_updated", "payment_intent.succeeded", "payment_intent.canceled", "charge.captured", "charge.succeeded", "charge.refunded"];
    const eventQuery = new URLSearchParams({ limit: "100" });
    if (Number.isFinite(bookingCreatedSeconds)) eventQuery.set("created[gte]", String(Math.max(bookingCreatedSeconds - 300, Math.floor(Date.now() / 1000) - 30 * 86400)));
    eventTypes.forEach((type) => eventQuery.append("types[]", type));
    const eventsResult = depositPiId ? await stripeGet(stripeSecret, `/events?${eventQuery.toString()}`, "STRIPE_EVENT_READ_FAILED") : null;
    const allEvents = Array.isArray(eventsResult?.data) ? eventsResult.data as StripeObject[] : [];
    const depositEvents = allEvents.filter((event) => {
      const data = event.data as StripeObject | undefined;
      const object = data?.object as StripeObject | undefined;
      const objectId = idOf(object?.id);
      const objectPi = idOf(object?.payment_intent);
      const metadata = object?.metadata as StripeObject | undefined;
      return objectId === depositPiId || objectId === depositChargeId || objectPi === depositPiId || metadata?.bookingId === booking.id;
    });

    // Discover all historical hold attempts. Exact ZONYX booking metadata is the
    // authoritative association; customer/time/amount list results remain only candidates.
    const exactQuery = `metadata['bookingId']:'${booking.id}' AND metadata['purpose']:'authorization_hold'`;
    const exactResult = await stripeGet(stripeSecret, `/payment_intents/search?query=${encodeURIComponent(exactQuery)}&limit=100`, "STRIPE_DEPOSIT_DISCOVERY_READ_FAILED");
    const customerParams = new URLSearchParams({ limit: "100" });
    const stripeCustomerId = booking.stripe_customer_id || idOf(checkout?.customer);
    if (stripeCustomerId) customerParams.set("customer", stripeCustomerId);
    const tripEndSeconds = Math.floor(new Date(`${booking.end_date}T23:59:59Z`).getTime() / 1000);
    if (Number.isFinite(bookingCreatedSeconds)) customerParams.set("created[gte]", String(Math.max(0, bookingCreatedSeconds - 86400)));
    if (Number.isFinite(tripEndSeconds)) customerParams.set("created[lte]", String(tripEndSeconds + 30 * 86400));
    const customerResult = stripeCustomerId ? await stripeGet(stripeSecret, `/payment_intents?${customerParams.toString()}`, "STRIPE_DEPOSIT_DISCOVERY_READ_FAILED") : null;
    const candidates = new Map<string, StripeObject>();
    [...listData(exactResult), ...listData(customerResult), ...(depositPaymentIntent ? [depositPaymentIntent] : [])].forEach((candidate) => {
      const id = idOf(candidate.id); if (id) candidates.set(id, candidate);
    });
    const rentalPaymentIntentId = idOf(rentalPaymentIntent);
    const depositAttempts = [];
    for (const candidate of candidates.values()) {
      const association = classifyDepositAttempt({ paymentIntent: candidate, bookingId: booking.id, storedDepositPaymentIntentId: booking.authorization_hold_payment_intent_id, rentalPaymentIntentId, stripeCustomerId, expectedAuthorizationAmount: booking.authorization_hold_amount_cents, windowStart: Number.isFinite(bookingCreatedSeconds) ? bookingCreatedSeconds - 86400 : null, windowEnd: Number.isFinite(tripEndSeconds) ? tripEndSeconds + 30 * 86400 : null });
      const candidateId = idOf(candidate.id);
      const candidatePi = candidateId ? await stripeGet(stripeSecret, stripeRetrievePath("payment_intents", candidateId), "STRIPE_DEPOSIT_READ_FAILED") : null;
      const candidatePiId = idOf(candidatePi);
      const candidateCharge = await expandedOrGet(stripeSecret, candidatePi?.latest_charge, "charges", "STRIPE_CHARGE_READ_FAILED", true);
      const candidateChargeId = idOf(candidateCharge);
      const candidateRefundsResult = candidatePiId ? await stripeGet(stripeSecret, `/refunds?payment_intent=${encodeURIComponent(candidatePiId)}&limit=100`, "STRIPE_REFUND_READ_FAILED") : null;
      const candidateBalancesResult = candidateChargeId ? await stripeGet(stripeSecret, `/balance_transactions?source=${encodeURIComponent(candidateChargeId)}&limit=100`, "STRIPE_BALANCE_READ_FAILED") : null;
      const candidateEvents = allEvents.filter((event) => {
        const object = (event.data as StripeObject | undefined)?.object as StripeObject | undefined;
        return idOf(object?.id) === candidatePiId || idOf(object?.id) === candidateChargeId || idOf(object?.payment_intent) === candidatePiId;
      });
      if (candidatePi) depositAttempts.push(normalizeDepositAttempt({ paymentIntent: candidatePi, charge: candidateCharge, refunds: listData(candidateRefundsResult), balanceTransactions: listData(candidateBalancesResult), events: candidateEvents, association }));
    }

    return json(200, buildFinancialSnapshot({ booking, checkout, lineItems, rentalPaymentIntent, rentalCharge, refunds, depositPaymentIntent, depositCharge, depositRefunds, depositBalanceTransactions, depositEvents, depositAttempts, observedAt: new Date().toISOString() }));
  } catch (error) {
    if (error instanceof InspectorError) return json(error.status, { code: error.code, error: error.message });
    return json(502, { code: "INTERNAL_READ_ERROR", error: "Unable to inspect Stripe state." });
  }
});