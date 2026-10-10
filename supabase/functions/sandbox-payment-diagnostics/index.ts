// Non-financial, exact-project diagnostics. Never changes activation gates or
// payment/database state. OAuth/SDK initialization and signature verification only.
import { X509Certificate } from "node:crypto";
import { trustedPayPalDiagnosticCertificate, verifyPayPalDiagnosticSignature } from "./signature.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PayPalClient } from "../_shared/paypal-client.ts";
import { verifySandboxStripeSignature } from "../stripe-checkout-sandbox/webhook-policy.ts";
const project = "https://pvowzjqimikcoyjwclez.supabase.co";
const tester = "52af03eb-1976-4db0-900a-6509b1c8405b";
const origin = "http://127.0.0.1:4175";
const gateNames = ["PAYPAL_PROVIDER_LOCK_READY", "PAYPAL_RENTAL_CHECKOUT_ENABLED", "PAYPAL_LIVE_RENTAL_PAYMENT_ENABLED", "PAYPAL_ADVANCED_CARD_ENABLED", "PAYPAL_SECURITY_DEPOSIT_ENABLED"];
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
serve(async request => {
  if (Deno.env.get("SUPABASE_URL") !== project || (Deno.env.get("PAYPAL_ENVIRONMENT") || "sandbox") !== "sandbox" || gateNames.some(name => Deno.env.get(name) === "true")) return reply(503, { error: "Exact sandbox project with all payment gates OFF required." });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });
  try {
    const raw = await request.text();
    if (raw.length > 100000) return reply(413, { error: "Payload too large." });
    const input = JSON.parse(raw);
    // Genuine signed events can be manually sent to this verification-only URL.
    // No receipt persistence, order lookup, settlement, capture or financial call.
    if (request.headers.has("stripe-signature")) {
      const secret = Deno.env.get("STRIPE_SANDBOX_WEBHOOK_SECRET");
      if (!secret || input.livemode !== false || !verifySandboxStripeSignature(raw, request.headers.get("stripe-signature")!, secret)) return reply(400, { verified: false });
      return reply(200, { verified: true, provider: "stripe", processing: "verification_only", gatesOff: true });
    }
    if (request.headers.has("paypal-transmission-sig")) {
      const certificateUrl = new URL(request.headers.get("paypal-cert-url") || "");
      if (!trustedPayPalDiagnosticCertificate(certificateUrl)) return reply(400, { verified: false });
      const certificateResponse = await fetch(certificateUrl, { redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!certificateResponse.ok) return reply(503, { error: "Sandbox signature certificate unavailable." });
      const pem = await certificateResponse.text();
      if (pem.length > 32000) return reply(400, { verified: false });
      const certificate = new X509Certificate(pem);
      if (Date.now() < Date.parse(certificate.validFrom) || Date.now() > Date.parse(certificate.validTo)) return reply(400, { verified: false });
      const id = Deno.env.get("PAYPAL_WEBHOOK_ID");
      if (id && verifyPayPalDiagnosticSignature(raw, request.headers, id, pem)) {
        const postbackVerified = await new PayPalClient(name => Deno.env.get(name)).verifyWebhook(request.headers, input, id);
        return reply(postbackVerified ? 200 : 400, { verified: postbackVerified, provider: "paypal", processing: "registered_app_verification_only", gatesOff: true });
      }
      // Simulator events use WEBHOOK_ID and cannot use PayPal's postback API.
      // Distinguish signed simulator transport from registered-app verification.
      if (verifyPayPalDiagnosticSignature(raw, request.headers, "WEBHOOK_ID", pem)) return reply(200, { verified: true, provider: "paypal", processing: "signed_simulator_verification_only", registeredAppPostbackStillPending: true, gatesOff: true });
      return reply(400, { verified: false });
    }
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return reply(401, { error: "Sandbox tester authentication required." });
    const userClient = createClient(project, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data, error } = await userClient.auth.getUser();
    if (error || data.user?.id !== tester) return reply(403, { error: "Only the isolated sandbox tester may run diagnostics." });
    if (Object.keys(input).length !== 1 || input.action !== "check") return reply(400, { error: "Only non-financial diagnostics are accepted." });
    const db = createClient(project, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: profile } = await db.from("profiles").select("is_internal_tester,is_admin").eq("user_id", tester).single();
    if (profile?.is_internal_tester !== true || profile?.is_admin !== false) return reply(403, { error: "Sandbox tester profile must be internal and non-admin." });
    const { data: driver, error: driverError } = await userClient.rpc("get_my_driver_eligibility", { _trip_end_date: "2026-10-15" });
    let sdkTokenEligible = false;
    try { sdkTokenEligible = Boolean(await new PayPalClient(name => Deno.env.get(name)).browserClientToken()); } catch { /* never serialize token/provider errors */ }
    let paypalCredentialsAccepted = false, webhookRegistered = false, webhookEndpointMatches = false, webhookEventsComplete = false;
    const required = ["CHECKOUT.ORDER.APPROVED", "CHECKOUT.ORDER.COMPLETED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"];
    try {
      const clientId = Deno.env.get("PAYPAL_SANDBOX_CLIENT_ID"), secret = Deno.env.get("PAYPAL_SANDBOX_CLIENT_SECRET"), webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
      if (clientId && secret && webhookId) {
        const tokenResponse = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal: AbortSignal.timeout(15000) });
        if (tokenResponse.ok) {
          const token = await tokenResponse.json();
          paypalCredentialsAccepted = typeof token.access_token === "string";
          if (paypalCredentialsAccepted) {
            const webhookResponse = await fetch(`https://api-m.sandbox.paypal.com/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000) });
            if (webhookResponse.ok) {
              const webhook = await webhookResponse.json();
              webhookRegistered = webhook.id === webhookId;
              webhookEndpointMatches = webhook.url === `${project}/functions/v1/paypal-webhook`;
              const subscribed = webhook.event_types?.map((event: { name: string }) => event.name) || [];
              webhookEventsComplete = subscribed.includes("*") || required.every(name => subscribed.includes(name));
            }
          }
        }
      }
    } catch { /* safe booleans only */ }
    return reply(200, { gatesOff: true, testerAuthenticated: true, testerInternal: true, testerAdmin: false, driverEligible: !driverError && driver?.[0]?.status === "eligible_self_attested", paypalCredentialsAccepted, sdkTokenEligible, webhookRegistered, webhookEndpointMatches, webhookEventsComplete, authenticSignatureStillPending: true, cardCapabilityStillPending: true });
  } catch { return reply(500, { error: "Non-financial diagnostic failed; no credential details returned." }); }
});
