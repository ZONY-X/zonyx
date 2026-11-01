import { runtimePaymentProvider } from "../_shared/payment-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, env, json, paymentFailure, serviceClient } from "../_shared/payment-service.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import { paymentAdapters } from "../_shared/payment-adapters/registry.ts";
serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const input = await request.json();
    if (!input || Object.keys(input).some(k => k !== "bookingId") || typeof input.bookingId !== "string") throw new PaymentError(400, "Booking identity required.");
    const auth = createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: request.headers.get("authorization") || "" } }, auth: { persistSession: false } });
    const { data: user, error: authError } = await auth.auth.getUser();
    if (authError || !user.user) throw new PaymentError(401, "Sign in to continue.");
    const db = serviceClient();
    const { data: profile, error: profileError } = await db.from("profiles").select("id").eq("user_id", user.user.id).single();
    if (profileError || !profile) throw new PaymentError(404, "Reservation unavailable.");
    const { data: booking, error: bookingError } = await db.from("bookings").select("id,stripe_checkout_session_id,stripe_customer_id,authorization_hold_payment_intent_id").eq("id", input.bookingId).eq("renter_profile_id", profile.id).single();
    if (bookingError || !booking) throw new PaymentError(404, "Reservation unavailable.");
    const { data: payment, error } = await db.from("booking_payments").select("provider").eq("booking_id", booking.id).maybeSingle();
    if (error) throw new PaymentError(503, "Existing payment lookup unavailable.");
    // Legacy Stripe evidence must never become a new transaction on another rail.
    const historical = payment?.provider || (booking.stripe_checkout_session_id || booking.stripe_customer_id || booking.authorization_hold_payment_intent_id ? "stripe" : null);
    const provider = await runtimePaymentProvider(db, env, historical);
    if (!Object.hasOwn(paymentAdapters, provider) || !paymentAdapters[provider as keyof typeof paymentAdapters].rental) throw new PaymentError(409, "Your existing payment requires support. No new payment was started.");
    return json(200, { provider });
  } catch (error) { return paymentFailure(error); }
});
