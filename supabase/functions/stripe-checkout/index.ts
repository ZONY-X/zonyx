import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CheckoutPayload {
  bookingId: string;
  internalBookingCode?: string;
}

const ZONYX_TAX_RATE = 0.08;
const STRIPE_MINIMUM_USD_CHARGE_CENTS = 50;

function isAuthorizedInternalTest(options: {
  enabledFlag?: string | null;
  configuredEmail?: string | null;
  configuredCode?: string | null;
  authedEmail?: string | null;
  providedCode?: string | null;
}): boolean {
  const enabled = options.enabledFlag === "true";
  const configuredEmail = (options.configuredEmail || "").trim();
  const configuredCode = options.configuredCode || "";
  const authedEmail = (options.authedEmail || "").trim();
  const providedCode = options.providedCode || "";

  return enabled
    && configuredEmail.length > 0
    && configuredCode.length > 0
    && authedEmail === configuredEmail
    && providedCode === configuredCode;
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
    const authHeader = req.headers.get("authorization") || "";
    const payload = (await req.json()) as CheckoutPayload;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const internalTestEnabled = Deno.env.get("ZONYX_INTERNAL_TEST_ENABLED");
    const internalTestEmail = Deno.env.get("ZONYX_INTERNAL_TEST_EMAIL");
    const internalTestCode = Deno.env.get("ZONYX_INTERNAL_TEST_CODE");

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
      throw new Error("Stripe and Supabase environment configuration is incomplete.");
    }

    if (!payload.bookingId) {
      throw new Error("A bookingId is required.");
    }

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authedUserData, error: authedUserError } = await userSupabase.auth.getUser();
    if (authedUserError || !authedUserData?.user) {
      return new Response(JSON.stringify({ error: "Invalid auth session." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const internalTestAuthorized = isAuthorizedInternalTest({
      enabledFlag: internalTestEnabled,
      configuredEmail: internalTestEmail,
      configuredCode: internalTestCode,
      authedEmail: authedUserData.user.email,
      providedCode: payload.internalBookingCode,
    });

    const { data: renterBooking, error: renterBookingError } = await userSupabase
      .from("bookings")
      .select("id, trip_status, stripe_checkout_session_id")
      .eq("id", payload.bookingId)
      .maybeSingle();

    if (renterBookingError) {
      throw renterBookingError;
    }

    if (!renterBooking) {
      return new Response(JSON.stringify({ error: "Booking not found for current user." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (renterBooking.trip_status !== "pending_payment") {
      return new Response(JSON.stringify({ error: "Booking is no longer eligible for checkout." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, reservation_number, subtotal_cents, service_fee_cents, taxes_cents, grand_total_cents, vehicle_id, renter_profile_id, host_profile_id, start_date, end_date, trip_status, stripe_checkout_session_id, stripe_customer_id")
      .eq("id", payload.bookingId)
      .maybeSingle();

    if (bookingError) {
      throw bookingError;
    }

    if (!booking) {
      throw new Error("Booking not found.");
    }

    if (booking.trip_status !== "pending_payment") {
      throw new Error("Booking is no longer pending payment.");
    }

    if (booking.stripe_checkout_session_id) {
      const existingSessionResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${booking.stripe_checkout_session_id}`, {
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
      });

      if (existingSessionResponse.ok) {
        const existingSession = await existingSessionResponse.json();
        if (existingSession?.url) {
          return new Response(JSON.stringify({ url: existingSession.url, sessionId: existingSession.id }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id, brand, model, category, vehicle_identifier")
      .eq("id", booking.vehicle_id)
      .maybeSingle();

    if (vehicleError) {
      throw vehicleError;
    }

    if (!vehicle) {
      throw new Error("Vehicle not found for booking.");
    }

    let checkoutCustomerId = typeof booking.stripe_customer_id === "string" && booking.stripe_customer_id.trim().length > 0
      ? booking.stripe_customer_id.trim()
      : null;

    if (!checkoutCustomerId && booking.renter_profile_id) {
      const { data: priorBookingWithCustomer } = await supabase
        .from("bookings")
        .select("stripe_customer_id")
        .eq("renter_profile_id", booking.renter_profile_id)
        .not("stripe_customer_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ stripe_customer_id: string | null }>();

      if (priorBookingWithCustomer?.stripe_customer_id?.trim()) {
        checkoutCustomerId = priorBookingWithCustomer.stripe_customer_id.trim();
      }
    }

    if (checkoutCustomerId) {
      const customerCheckResponse = await fetch(`https://api.stripe.com/v1/customers/${checkoutCustomerId}`, {
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
      });

      if (!customerCheckResponse.ok) {
        checkoutCustomerId = null;
      }
    }

    let checkoutSubtotalCents = Number(booking.subtotal_cents || 0);
    let checkoutServiceFeeCents = Number(booking.service_fee_cents || 0);
    let checkoutTaxesCents = Number(booking.taxes_cents || 0);
    let checkoutGrandTotalCents = Number(booking.grand_total_cents || 0);

    if (internalTestAuthorized) {
      const discountedSubtotalCents = Math.max(1, Math.round(checkoutSubtotalCents * 0.01));
      const discountedServiceFeeCents = 0;
      const discountedTaxesCents = Math.round(discountedSubtotalCents * ZONYX_TAX_RATE);
      const discountedGrandTotalCents = Math.max(
        STRIPE_MINIMUM_USD_CHARGE_CENTS,
        discountedSubtotalCents + discountedServiceFeeCents + discountedTaxesCents,
      );

      checkoutSubtotalCents = discountedSubtotalCents;
      checkoutServiceFeeCents = discountedServiceFeeCents;
      checkoutTaxesCents = discountedTaxesCents;
      checkoutGrandTotalCents = discountedGrandTotalCents;

      const { error: updatePricingError } = await supabase
        .from("bookings")
        .update({
          subtotal_cents: checkoutSubtotalCents,
          service_fee_cents: checkoutServiceFeeCents,
          taxes_cents: checkoutTaxesCents,
          grand_total_cents: checkoutGrandTotalCents,
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id)
        .eq("trip_status", "pending_payment");

      if (updatePricingError) {
        throw updatePricingError;
      }
    }

    const requestOrigin = req.headers.get("origin") || "http://localhost:4173";
    const successUrl = new URL("/booking/success", requestOrigin);
    successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    const cancelUrl = new URL("/booking/cancel", requestOrigin);
    cancelUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

    const stripeParams = new URLSearchParams({
      mode: "payment",
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      "payment_method_types[0]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(checkoutGrandTotalCents),
      "line_items[0][price_data][product_data][name]": `${vehicle.brand} ${vehicle.model}`,
      "line_items[0][price_data][product_data][description]": `Reservation ${booking.reservation_number}`,
      "metadata[bookingId]": booking.id,
      "metadata[reservationNumber]": booking.reservation_number,
      "metadata[vehicleId]": vehicle.id,
      "metadata[vehicleIdentifier]": vehicle.vehicle_identifier,
      "metadata[vehicleType]": vehicle.model,
      "metadata[rentalDays]": String(Math.max(1, Math.round((new Date(`${booking.end_date}T00:00:00`).getTime() - new Date(`${booking.start_date}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24)))),
      "metadata[booking_type]": internalTestAuthorized ? "internal_test" : "standard",
      "metadata[internal_test]": internalTestAuthorized ? "true" : "false",
    });

    stripeParams.set("payment_intent_data[setup_future_usage]", "off_session");
    stripeParams.set("payment_intent_data[metadata][bookingId]", booking.id);
    stripeParams.set("payment_intent_data[metadata][reservationNumber]", booking.reservation_number);
    stripeParams.set("payment_intent_data[metadata][vehicleId]", vehicle.id);
    stripeParams.set("payment_intent_data[metadata][vehicleType]", vehicle.model);
    stripeParams.set("payment_intent_data[metadata][booking_type]", internalTestAuthorized ? "internal_test" : "standard");
    stripeParams.set("payment_intent_data[metadata][internal_test]", internalTestAuthorized ? "true" : "false");

    if (checkoutCustomerId) {
      stripeParams.set("customer", checkoutCustomerId);
    } else {
      stripeParams.set("customer_creation", "always");
      if (authedUserData.user.email) {
        stripeParams.set("customer_email", authedUserData.user.email);
      }
    }

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `checkout-session:${booking.id}`,
      },
      body: stripeParams.toString(),
    });

    if (!stripeResponse.ok) {
      let stripeErrorMessage = "Unable to create Stripe checkout session.";
      try {
        const stripeErrorPayload = await stripeResponse.json();
        stripeErrorMessage = stripeErrorPayload?.error?.message || stripeErrorPayload?.error?.type || stripeErrorMessage;
      } catch {
        const stripeErrorText = await stripeResponse.text();
        if (stripeErrorText) {
          stripeErrorMessage = stripeErrorText;
        }
      }

      console.error("Stripe checkout error:", stripeErrorMessage);
      return new Response(JSON.stringify({ error: stripeErrorMessage }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeData = await stripeResponse.json();

    const { error: attachError } = await userSupabase.rpc("attach_checkout_session_to_booking", {
      _booking_id: booking.id,
      _stripe_checkout_session_id: stripeData.id,
    });

    if (attachError) {
      throw attachError;
    }

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
