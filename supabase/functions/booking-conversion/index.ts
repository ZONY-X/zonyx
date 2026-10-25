import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

// Read-only: the existing receipt RPC owns the bookingConfirmed decision.
// User-scoped RLS, never service-role access or a call to a payment processor.
serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });
  try {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return reply(401, { error: "Sign in to verify your booking." });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return reply(401, { error: "Valid authentication required." });
    const input = await request.json();
    if (Object.keys(input).some(key => key !== "bookingId") || typeof input.bookingId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.bookingId)) return reply(400, { error: "Valid booking reference required." });
    const { data: profile, error: profileError } = await db.from("profiles").select("id").eq("user_id", auth.user.id).single();
    const { data: booking, error: bookingError } = await db.from("bookings").select("id,renter_profile_id").eq("id", input.bookingId).single();
    if (profileError || bookingError || !profile || !booking || booking.renter_profile_id !== profile.id) return reply(404, { error: "Booking not found." });
    const { data: receipt, error: receiptError } = await db.rpc("get_provider_rental_payment_receipt", { _booking_id: booking.id });
    const { data: payment, error: paymentError } = await db.from("booking_payments").select("id,provider,environment,state,amount_cents,currency,paid_at,capture_id").eq("booking_id", booking.id).eq("provider", "square").maybeSingle();
    if (receiptError || paymentError) return reply(503, { error: "Booking verification is temporarily unavailable." });
    const verified = receipt?.bookingConfirmed === true && receipt.provider === "square" && receipt.state === "paid" && receipt.reconciliationRequired === false && receipt.refundedAmountCents === 0
      && ["live", "sandbox"].includes(payment?.environment) && payment.state === "paid" && !!payment.capture_id && Number.isFinite(Date.parse(payment.paid_at))
      && Number.isSafeInteger(payment.amount_cents) && payment.amount_cents > 0 && receipt.capturedAmountCents === payment.amount_cents && receipt.amountCents === payment.amount_cents
      && /^[A-Z]{3}$/.test(String(payment.currency).toUpperCase()) && String(receipt.currency).toUpperCase() === String(payment.currency).toUpperCase();
    if (!verified) return reply(200, { bookingConfirmed: false, purchase: null });
    const paymentSummary = { value: payment.amount_cents / 100, currency: String(payment.currency).toUpperCase() };
    // Sandbox confirmation is useful to testers; it is never Google revenue.
    return reply(200, { bookingConfirmed: true, paymentSummary, purchase: payment.environment === "live" ? { transaction_id: `zonyx_square_${payment.id}`, ...paymentSummary, paidAt: payment.paid_at } : null });
  } catch {
    return reply(400, { error: "Unable to verify this booking." });
  }
});
