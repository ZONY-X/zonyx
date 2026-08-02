import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { calculateAuthorizationHold } from "../../../src/lib/authorizationHold.ts";

interface BookingRow {
  id: string;
  trip_status?: string | null;
  renter_profile_id?: string | null;
  vehicle_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_customer_id?: string | null;
  stripe_payment_method_id?: string | null;
  authorization_hold_payment_intent_id?: string | null;
  authorization_hold_amount_cents?: number | null;
  authorization_hold_status?: string | null;
  authorization_hold_capture_before?: number | null;
  authorization_hold_created_at?: string | null;
}

interface VehicleRow {
  id: string;
  brand: string;
  model: string;
  category: string;
  vehicle_identifier: string;
}

interface AuthorizationHoldResult {
  paymentIntentId: string;
  status: string;
  amount: number;
  captureBefore: number;
  extendedAuthorizationStatus: string;
}

function isInternalTestHoldAuthorized(options: {
  enabledFlag?: string | null;
  configuredEmail?: string | null;
  bookingEmail?: string | null;
  sessionInternalTestFlag?: string | null;
  sessionBookingType?: string | null;
}): boolean {
  const enabled = options.enabledFlag === "true";
  const configuredEmail = (options.configuredEmail || "").trim();
  const bookingEmail = (options.bookingEmail || "").trim();
  const sessionInternal = options.sessionInternalTestFlag === "true";
  const sessionTypeIsInternal = options.sessionBookingType === "internal_test";

  return enabled
    && configuredEmail.length > 0
    && configuredEmail === bookingEmail
    && sessionInternal
    && sessionTypeIsInternal;
}

export async function createAuthorizationHoldForCheckoutSession(options: {
  stripeSecretKey: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  checkoutSessionId?: string;
  bookingId?: string;
}): Promise<AuthorizationHoldResult> {
  const { stripeSecretKey, supabaseUrl, supabaseServiceRoleKey, checkoutSessionId, bookingId } = options;

  let resolvedCheckoutSessionId = checkoutSessionId;
  let bookingRow: BookingRow | null = null;
  let bookingEmail: string | null = null;

  if (supabaseUrl && supabaseServiceRoleKey && bookingId) {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data } = await supabase
      .from("bookings")
      .select("id, trip_status, renter_profile_id, vehicle_id, start_date, end_date, stripe_checkout_session_id, stripe_customer_id, stripe_payment_method_id, authorization_hold_payment_intent_id, authorization_hold_amount_cents, authorization_hold_status, authorization_hold_capture_before, authorization_hold_created_at")
      .eq("id", bookingId)
      .maybeSingle<BookingRow>();

    bookingRow = data;

    if (bookingRow?.authorization_hold_payment_intent_id && bookingRow.authorization_hold_status) {
      return {
        paymentIntentId: bookingRow.authorization_hold_payment_intent_id,
        status: bookingRow.authorization_hold_status,
        amount: bookingRow.authorization_hold_amount_cents ?? 0,
        captureBefore: bookingRow.authorization_hold_capture_before ?? 0,
        extendedAuthorizationStatus: "existing",
      };
    }

    if (!resolvedCheckoutSessionId && bookingRow?.stripe_checkout_session_id) {
      resolvedCheckoutSessionId = bookingRow.stripe_checkout_session_id;
    }

    if (bookingRow?.renter_profile_id) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", bookingRow.renter_profile_id)
        .maybeSingle<{ email: string | null }>();
      bookingEmail = profileData?.email || null;
    }
  }

  if (!resolvedCheckoutSessionId) {
    throw new Error("A verified Stripe Checkout Session ID is required.");
  }

  const sessionResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${resolvedCheckoutSessionId}?expand[]=payment_intent`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });

  if (!sessionResponse.ok) {
    const errorPayload = await sessionResponse.text();
    throw new Error(errorPayload || "Unable to load the Stripe checkout session.");
  }

  const session = await sessionResponse.json();

  if (session.payment_status !== "paid") {
    throw new Error(`Checkout session is not paid. Current status: ${session.payment_status}`);
  }

  const paymentMethodTypes = Array.isArray(session.payment_method_types) ? session.payment_method_types : [];

  if (!paymentMethodTypes.includes("card")) {
    throw new Error("Authorization holds are only supported for card-compatible checkout sessions.");
  }

  const paymentIntent = session.payment_intent;
  const customerId = session.customer || paymentIntent?.customer || null;
  const paymentMethodId = paymentIntent?.payment_method || null;

  if (!customerId || !paymentMethodId) {
    throw new Error("The completed checkout session does not expose a customer or payment method for the authorization hold.");
  }

  let vehicle: VehicleRow | null = null;
  if (supabaseUrl && supabaseServiceRoleKey && bookingRow?.vehicle_id) {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: vehicleData } = await supabase
      .from("vehicles")
      .select("id, brand, model, category, vehicle_identifier")
      .eq("id", bookingRow.vehicle_id)
      .maybeSingle<VehicleRow>();

    vehicle = vehicleData;
  }

  const rentalDays = bookingRow?.start_date && bookingRow?.end_date
    ? Math.max(1, Math.round((new Date(`${bookingRow.end_date}T00:00:00`).getTime() - new Date(`${bookingRow.start_date}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24)))
    : Number(session.metadata?.rentalDays ?? session.metadata?.nights ?? 0);
  const vehicleType = vehicle?.model || vehicle?.brand || session.metadata?.vehicleType || session.metadata?.vehicleId || "";
  const serverCalculatedAuthorizationHold = calculateAuthorizationHold(vehicleType, rentalDays);
  const internalTestHoldAuthorized = isInternalTestHoldAuthorized({
    enabledFlag: Deno.env.get("ZONYX_INTERNAL_TEST_ENABLED"),
    configuredEmail: Deno.env.get("ZONYX_INTERNAL_TEST_EMAIL"),
    bookingEmail,
    sessionInternalTestFlag: session.metadata?.internal_test,
    sessionBookingType: session.metadata?.booking_type,
  });
  const holdAmountCents = internalTestHoldAuthorized ? 100 : serverCalculatedAuthorizationHold * 100;

  const paymentIntentBody = new URLSearchParams({
    amount: String(holdAmountCents),
    currency: "usd",
    customer: customerId,
    payment_method: paymentMethodId,
    capture_method: "manual",
    confirm: "true",
    off_session: "true",
    "payment_method_types[0]": "card",
    "payment_method_options[card][request_extended_authorization]": "if_available",
    "metadata[bookingId]": session.metadata?.bookingId || bookingId || "",
    "metadata[vehicleId]": bookingRow?.vehicle_id || session.metadata?.vehicleId || "",
    "metadata[vehicleType]": vehicleType,
    "metadata[rentalDays]": String(rentalDays),
    "metadata[purpose]": "authorization_hold",
    "metadata[booking_type]": internalTestHoldAuthorized ? "internal_test" : "standard",
    "metadata[internal_test]": internalTestHoldAuthorized ? "true" : "false",
    expand: "latest_charge",
  });

  const paymentIntentResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `authorization-hold:${bookingId || session.metadata?.bookingId || resolvedCheckoutSessionId}`,
    },
    body: paymentIntentBody.toString(),
  });

  if (!paymentIntentResponse.ok) {
    const errorPayload = await paymentIntentResponse.text();
    throw new Error(errorPayload || "Authorization hold payment intent creation failed.");
  }

  const paymentIntentData = await paymentIntentResponse.json();
  const status = paymentIntentData.status;
  const latestCharge = paymentIntentData.latest_charge;
  const latestChargeCaptureBefore = typeof latestCharge === "object" && latestCharge !== null
    ? latestCharge.payment_method_details?.card?.capture_before
    : null;
  const captureBefore = Number(latestChargeCaptureBefore ?? paymentIntentData.amount_capturable ?? paymentIntentData.amount ?? serverCalculatedAuthorizationHold * 100);
  const isSuccessfulRealHold = status === "requires_capture" || status === "succeeded" || status === "processing";
  const result: AuthorizationHoldResult = {
    paymentIntentId: paymentIntentData.id,
    status,
    amount: paymentIntentData.amount ?? holdAmountCents,
    captureBefore,
    extendedAuthorizationStatus: isSuccessfulRealHold ? "success" : "requested",
  };

  if (supabaseUrl && supabaseServiceRoleKey && (bookingId || session.metadata?.bookingId)) {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const bookingIdentifier = bookingId || session.metadata?.bookingId || null;
    if (bookingIdentifier) {
      await supabase
        .from("bookings")
        .update({
          stripe_checkout_session_id: resolvedCheckoutSessionId,
          stripe_customer_id: customerId,
          stripe_payment_method_id: paymentMethodId,
          authorization_hold_payment_intent_id: paymentIntentData.id,
          authorization_hold_amount_cents: paymentIntentData.amount ?? holdAmountCents,
          authorization_hold_status: status,
          authorization_hold_capture_before: captureBefore,
          authorization_hold_created_at: new Date().toISOString(),
          trip_status: "confirmed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingIdentifier)
        .in("trip_status", ["pending_payment", "payment_failed", "confirmed"]);
    }
  }

  return result;
}
