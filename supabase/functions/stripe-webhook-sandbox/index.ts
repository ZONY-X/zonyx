import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifySandboxStripeSignature } from "../stripe-checkout-sandbox/webhook-policy.ts";
const response = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
serve(async request => {
  if (request.method !== "POST") return response(405, { error: "Method not allowed." });
  if (Deno.env.get("PAYPAL_PROVIDER_LOCK_READY") !== "true" || Deno.env.get("PAYPAL_ENVIRONMENT") !== "sandbox" || Deno.env.get("SUPABASE_URL") !== "https://pvowzjqimikcoyjwclez.supabase.co") return response(503, { error: "Coordinated sandbox payments are disabled." });
  try {
    const key = Deno.env.get("STRIPE_SECRET_KEY");
    const signingSecret = Deno.env.get("STRIPE_SANDBOX_WEBHOOK_SECRET");
    if (!key?.startsWith("sk_test_") || !signingSecret) return response(503, { error: "Sandbox webhook configuration required." });
    const raw = await request.text();
    if (raw.length > 100000) return response(413, { error: "Payload too large." });
    if (!verifySandboxStripeSignature(raw, request.headers.get("stripe-signature") || "", signingSecret)) return response(400, { error: "Invalid sandbox signature." });
    const event = JSON.parse(raw);
    if (event.livemode !== false) return response(400, { error: "Only sandbox events accepted." });
    if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return response(200, { received: true });
    const id = event.data?.object?.id;
    if (typeof id !== "string" || !id.startsWith("cs_test_")) return response(400, { error: "Sandbox session identity required." });
    // Signature alone is insufficient: read canonical evidence, never create a
    // payment, capture, deposit, refund, notification or trip confirmation.
    const canonicalResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!canonicalResponse.ok) return response(503, { error: "Canonical session unavailable; redeliver." });
    const session = await canonicalResponse.json();
    if (session.id !== id || session.livemode !== false || session.payment_status !== "paid" || session.status !== "complete" || typeof session.payment_intent !== "string") return response(409, { error: "Session settlement requires reconciliation." });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: payment, error } = await db.from("booking_payments").select("id,booking_id,amount_cents,currency").eq("provider", "stripe").eq("environment", "sandbox").eq("order_id", id).maybeSingle();
    if (error || !payment) return response(409, { error: "Session is not attached; redeliver after reconciliation." });
    if (session.metadata?.bookingId !== payment.booking_id || session.amount_total !== Number(payment.amount_cents) || session.currency !== payment.currency) return response(409, { error: "Canonical settlement evidence conflicts." });
    const { error: settlementError } = await db.rpc("finalize_sandbox_stripe_payment", { _payment_id: payment.id, _session_id: id, _capture_id: session.payment_intent, _amount_cents: session.amount_total, _currency: session.currency });
    if (settlementError) return response(409, { error: "Shared reservation settlement requires reconciliation." });
    return response(200, { received: true, bookingConfirmed: false });
  } catch {
    return response(500, { error: "Sandbox webhook requires reconciliation and redelivery." });
  }
});
