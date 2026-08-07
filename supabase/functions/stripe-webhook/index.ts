import { createHmac, timingSafeEqual } from "node:crypto";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthorizationHoldForCheckoutSession } from "../_shared/authorization-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function verifyStripeSignature(payload: string, signatureHeader: string, webhookSecret: string) {
  const parts = signatureHeader.split(",").map((part) => part.trim()).filter(Boolean);
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signature = parts.find((part) => part.startsWith("v1="))?.slice(3);

  if (!timestamp || !signature) {
    throw new Error("Invalid Stripe signature header.");
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");
  const expectedBuffer = new TextEncoder().encode(expectedSignature);
  const providedBuffer = new TextEncoder().encode(signature);

  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new Error("Invalid Stripe signature");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature") ?? "";
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeSecretKey || !webhookSecret) {
      throw new Error("Stripe webhook secret is not configured.");
    }

    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing Stripe signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      verifyStripeSignature(body, signature, webhookSecret);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid Stripe signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const event = JSON.parse(body);

    if (event.type !== "checkout.session.completed") {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessionId = event.data?.object?.id;
    const bookingId = event.data?.object?.metadata?.bookingId;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Missing checkout session id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await createAuthorizationHoldForCheckoutSession({
      stripeSecretKey,
      supabaseUrl,
      supabaseServiceRoleKey,
      checkoutSessionId: sessionId,
      bookingId,
    });

    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
    if (edgeRuntime?.waitUntil && bookingId && supabaseUrl && supabaseServiceRoleKey) {
      edgeRuntime.waitUntil((async () => {
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceRoleKey}`,
              apikey: supabaseServiceRoleKey,
            },
            body: JSON.stringify({ bookingId }),
          });

          if (!response.ok) {
            const responseText = await response.text();
            console.error("stripe-webhook: confirmation email function failed", {
              bookingId,
              status: response.status,
              body: responseText,
            });
          }
        } catch (emailError) {
          console.error("stripe-webhook: confirmation email task error", {
            bookingId,
            error: emailError instanceof Error ? emailError.message : "Unknown error",
          });
        }
      })());
    }

    return new Response(JSON.stringify({ received: true, result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
