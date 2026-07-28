import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CheckoutPayload {
  vehicleId: string;
  vehicleName: string;
  vehiclePrice: number;
  startDate: string;
  endDate: string;
  nights: number;
  subtotal: number;
  serviceFee: number;
  taxes: number;
  total: number;
  addOns: Array<{ key: string; title: string; price: number }>;
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
    const payload = (await req.json()) as CheckoutPayload;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const requestOrigin = req.headers.get("origin") || "http://localhost:4173";
    const successUrl = new URL("/booking/success", requestOrigin);
    successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    const cancelUrl = new URL("/booking/cancel", requestOrigin);
    cancelUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mode: "payment",
        success_url: successUrl.toString(),
        cancel_url: cancelUrl.toString(),
        customer_email: "",
        payment_method_types: "card",
        allow_promotion_codes: "true",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(Math.round(payload.total * 100)),
        "line_items[0][price_data][product_data][name]": payload.vehicleName,
        "line_items[0][price_data][product_data][description]": `${payload.vehicleName} • ${payload.nights} day rental`,
        "metadata[vehicleId]": payload.vehicleId,
        "metadata[vehicleName]": payload.vehicleName,
        "metadata[startDate]": payload.startDate,
        "metadata[endDate]": payload.endDate,
        "metadata[nights]": String(payload.nights),
        "metadata[subtotal]": String(payload.subtotal),
        "metadata[serviceFee]": String(payload.serviceFee),
        "metadata[taxes]": String(payload.taxes),
        "metadata[total]": String(payload.total),
      }).toString(),
    });

    if (!stripeResponse.ok) {
      const stripeError = await stripeResponse.text();
      console.error("Stripe checkout error:", stripeError);
      return new Response(JSON.stringify({ error: "Unable to create Stripe checkout session." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeData = await stripeResponse.json();

    return new Response(JSON.stringify({ url: stripeData.url, sessionId: stripeData.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("stripe checkout error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
