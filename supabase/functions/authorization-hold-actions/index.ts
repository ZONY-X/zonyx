// Module 1B: server-side security-deposit release/capture for hosts/admins.
// Uses the EXISTING manual-capture PaymentIntent created by create-authorization-hold
// (checkout.session.completed flow). Creates no new charge and no new PaymentIntent:
// cancel = release of the uncaptured authorization; capture = capture of the existing one.
// Decision logic lives in _shared/authorization-hold-actions.ts (unit-tested).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseHoldRequest, planHoldAction } from "../_shared/authorization-hold-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function stripeCall(
  stripeSecretKey: string,
  path: string,
  params?: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: params ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseAnonKey) {
      throw new Error("Stripe/Supabase environment is not configured");
    }
    if (!authHeader) {
      return json(401, { error: "Authentication required." });
    }

    // User-scoped client: the forwarded JWT drives RLS and auth.uid() inside RPCs.
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await userSupabase.auth.getUser();
    if (authError || !authData?.user) {
      return json(401, { error: "Invalid auth session." });
    }

    const parsed = parseHoldRequest(await req.json());
    if (!parsed.ok) {
      return json(400, { error: parsed.error });
    }
    const bookingId = parsed.bookingId!;
    const action = parsed.action!;

    // Authorization: admin, or the booking's own host. The RLS-scoped select
    // only returns rows the caller may see; the explicit checks below enforce
    // host/admin regardless of how permissive SELECT policy is.
    const { data: booking, error: bookingError } = await userSupabase
      .from("bookings")
      .select(
        "id, host_profile_id, authorization_hold_payment_intent_id, authorization_hold_amount_cents, authorization_hold_status, authorization_hold_capture_before",
      )
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!booking) {
      return json(404, { error: "Booking not found for current user." });
    }

    const { data: isAdmin, error: adminError } = await userSupabase.rpc("current_profile_is_admin");
    if (adminError) throw adminError;

    let isHost = false;
    if (!isAdmin) {
      const { data: profileId, error: profileError } = await userSupabase.rpc("current_profile_id");
      if (profileError) throw profileError;
      isHost = Boolean(profileId) && profileId === booking.host_profile_id;
    }
    if (!isAdmin && !isHost) {
      return json(403, { error: "Only the host or an admin can manage this deposit." });
    }

    // Live Stripe state for the stored PaymentIntent (read-only lookup).
    const piPath = `/v1/payment_intents/${encodeURIComponent(booking.authorization_hold_payment_intent_id)}`;
    const piResult = await stripeCall(stripeSecretKey, piPath);
    if (!piResult.ok) {
      return json(502, { error: "Unable to verify the deposit authorization with Stripe. No action was taken." });
    }
    const pi = piResult.body as { status?: string; amount_capturable?: number };

    const plan = planHoldAction({
      action,
      dbHoldStatus: booking.authorization_hold_status,
      dbPaymentIntentId: booking.authorization_hold_payment_intent_id,
      stripePaymentIntentStatus: pi.status ?? null,
      stripeCapturableCents: typeof pi.amount_capturable === "number" ? pi.amount_capturable : null,
      requestedAmountCents: parsed.amountCents ?? null,
      captureBeforeMs: booking.authorization_hold_capture_before
        ? Date.parse(booking.authorization_hold_capture_before)
        : null,
      nowMs: Date.now(),
    });

    if (!plan.ok) {
      return json(plan.httpStatus, { error: plan.error });
    }

    // Money movement happens ONLY here, against the EXISTING authorization.
    if (plan.stripeAction === "cancel") {
      const cancelResult = await stripeCall(stripeSecretKey, `${piPath}/cancel`, {});
      if (!cancelResult.ok) {
        return json(502, { error: "Stripe refused the release request. Nothing was persisted; it is safe to retry." });
      }
    } else if (plan.stripeAction === "capture") {
      const captureResult = await stripeCall(stripeSecretKey, `${piPath}/capture`, {
        amount_to_capture: String(plan.stripeAmountCents),
      });
      if (!captureResult.ok) {
        return json(502, { error: "Stripe refused the capture request. Nothing was persisted; it is safe to retry." });
      }
    }
    // stripeAction === "none": no Stripe call — idempotent convergence only.

    const { error: persistError } = await userSupabase.rpc("persist_authorization_hold_outcome", {
      _booking_id: bookingId,
      _status: plan.persistStatus,
      _captured_amount_cents: plan.persistStatus === "captured" ? plan.stripeAmountCents : null,
    });
    if (persistError) {
      return json(502, {
        error: `Stripe action succeeded but persisting the outcome failed: ${persistError.message}`,
      });
    }

    return json(200, {
      ok: true,
      holdStatus: plan.persistStatus,
      capturedAmountCents: plan.persistStatus === "captured" ? plan.stripeAmountCents : null,
      alreadyFinalized: plan.alreadyFinalized === true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return json(500, { error: message });
  }
});

