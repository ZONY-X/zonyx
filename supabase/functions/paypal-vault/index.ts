import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PayPalClient } from "../_shared/paypal-client.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import {
  authenticate,
  corsHeaders,
  env,
  json,
  paymentFailure,
  serviceClient,
} from "../_shared/payment-service.ts";

const categories = new Set([
  "tolls",
  "charging_energy",
  "excess_mileage",
  "damage",
]);

async function digest(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function assertEnabled() {
  if (env("PAYPAL_VAULT_ENABLED") !== "true") {
    throw new PaymentError(503, "PayPal saved payment methods are disabled.");
  }
  if (
    env("PAYPAL_ENVIRONMENT") === "live" &&
    env("PAYPAL_VAULT_LIVE_ENABLED") !== "true"
  ) {
    throw new PaymentError(503, "PayPal saved payment methods are not live-enabled.");
  }
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    assertEnabled();
    const input = await request.json();
    const action = input?.action;
    const user = await authenticate(request, action === "list-for-booking");
    if (!["create-setup-token", "store-setup-token", "list", "list-for-booking", "revoke"].includes(action)) {
      throw new PaymentError(400, "Unsupported saved payment method action.");
    }
    const db = serviceClient();
    const { data: profile, error: profileError } = await db.from("profiles")
      .select("id,is_admin").eq("user_id", user.id).maybeSingle();
    if (profileError || !profile) throw new PaymentError(404, "Payment profile not found.");

    if (action === "create-setup-token") {
      if (input.bookingId !== undefined && (typeof input.bookingId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.bookingId))) {
        throw new PaymentError(400, "Booking identity is invalid.");
      }
      if (input.bookingId) {
        const { data: booking, error: bookingError } = await db.from("bookings")
          .select("id,renter_profile_id").eq("id", input.bookingId).maybeSingle();
        if (bookingError || !booking || booking.renter_profile_id !== profile.id) {
          throw new PaymentError(404, "Booking not found.");
        }
        const { data: agreement, error: agreementError } = await db.from("booking_rental_agreements")
          .select("id").eq("booking_id", input.bookingId).eq("guest_profile_id", profile.id)
          .not("accepted_at", "is", null).order("accepted_at", { ascending: false })
          .limit(1).maybeSingle();
        if (agreementError || !agreement) throw new PaymentError(409, "Accepted rental agreement required.");
      }
      const token = await new PayPalClient(env).createVaultSetupToken({
        payment_source: {
          card: {
            verification_method: "SCA_WHEN_REQUIRED",
            usage_type: "MERCHANT",
          },
        },
      }, crypto.randomUUID());
      if (!token.id) throw new PaymentError(502, "PayPal did not create a vault setup token.");
      return json(200, { vaultSetupToken: token.id });
    }

    if (action === "list" || action === "list-for-booking") {
      let ownerProfileId = profile.id;
      if (action === "list-for-booking") {
        if (!profile.is_admin || typeof input.bookingId !== "string") {
          throw new PaymentError(403, "Administrator booking access is required.");
        }
        const { data: booking, error: bookingError } = await db.from("bookings")
          .select("renter_profile_id").eq("id", input.bookingId).maybeSingle();
        if (bookingError || !booking) throw new PaymentError(404, "Booking not found.");
        ownerProfileId = booking.renter_profile_id;
      }
      const { data, error } = await db.from("paypal_payment_sources")
        .select("id,environment,status,created_at,last_used_at")
        .eq("profile_id", ownerProfileId).order("created_at", { ascending: false });
      if (error) throw new PaymentError(503, "Saved payment methods are unavailable.");
      return json(200, { paymentMethods: data ?? [] });
    }

    if (action === "revoke") {
      if (typeof input.paymentSourceId !== "string") {
        throw new PaymentError(400, "Payment method identity is required.");
      }
      const { data: source, error: sourceError } = await db.from("paypal_payment_sources")
        .select("id").eq("id", input.paymentSourceId).eq("profile_id", profile.id)
        .maybeSingle();
      if (sourceError || !source) throw new PaymentError(404, "Payment method not found.");
      const { error } = await db.from("paypal_payment_sources")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", source.id).eq("profile_id", profile.id);
      if (error) throw new PaymentError(503, "Payment method revocation failed.");
      const { error: consentError } = await db.from("paypal_payment_consents")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_reason: "Customer revoked saved payment method",
        })
        .eq("payment_source_id", source.id).eq("profile_id", profile.id)
        .is("revoked_at", null);
      if (consentError) throw new PaymentError(503, "Payment consent revocation failed.");
      return json(200, { revoked: true });
    }

    const setupToken = input.setupToken;
    const scope = input.scope;
    const termsVersion = input.termsVersion;
    const bookingId = input.bookingId;
    const consentText = input.consentText;
    const requestedCategories = Array.isArray(input.categories)
      ? input.categories.filter((value: unknown): value is string => typeof value === "string")
      : [];
    if (
      typeof setupToken !== "string" || setupToken.length < 10 || setupToken.length > 200 ||
      !/^[A-Za-z0-9_-]+$/.test(setupToken) ||
      !["security_deposit", "after_trip_charges"].includes(scope) ||
      typeof termsVersion !== "string" || termsVersion.length < 1 || termsVersion.length > 80 ||
      typeof consentText !== "string" || consentText.length < 20 || consentText.length > 2000 ||
      (scope === "after_trip_charges" &&
        (requestedCategories.length === 0 || requestedCategories.some((category) => !categories.has(category))))
    ) {
      throw new PaymentError(400, "Complete saved payment consent is required.");
    }
    if (bookingId !== undefined && (typeof bookingId !== "string" || !/^[0-9a-f-]{36}$/i.test(bookingId))) {
      throw new PaymentError(400, "Booking identity is invalid.");
    }
    let agreementId: string | null = null;
    if (bookingId) {
      const { data: booking, error: bookingError } = await db.from("bookings")
        .select("id,renter_profile_id").eq("id", bookingId).maybeSingle();
      if (bookingError || !booking || booking.renter_profile_id !== profile.id) {
        throw new PaymentError(404, "Booking not found.");
      }
      const { data: agreement, error: agreementError } = await db.from("booking_rental_agreements")
        .select("id,accepted_at,guest_profile_id").eq("booking_id", bookingId)
        .eq("guest_profile_id", profile.id).not("accepted_at", "is", null)
        .order("accepted_at", { ascending: false }).limit(1).maybeSingle();
      if (agreementError || !agreement) throw new PaymentError(409, "Accepted rental agreement required.");
      agreementId = agreement.id;
    }
    const requestId = crypto.randomUUID();
    const { error: requestError } = await db.from("paypal_vault_requests").insert({
      setup_token: setupToken,
      profile_id: profile.id,
      request_id: requestId,
    });
    if (requestError) {
      const { data: existingRequest, error: existingRequestError } = await db.from("paypal_vault_requests")
        .select("payment_source_id").eq("setup_token", setupToken).eq("profile_id", profile.id)
        .maybeSingle();
      if (existingRequestError) throw new PaymentError(503, "Saved payment request reconciliation is unavailable.");
      if (existingRequest?.payment_source_id) {
        const { data: existingSource } = await db.from("paypal_payment_sources")
          .select("id,environment,status,created_at").eq("id", existingRequest.payment_source_id).maybeSingle();
        const { data: existingConsent } = await db.from("paypal_payment_consents")
          .select("id").eq("payment_source_id", existingRequest.payment_source_id)
          .eq("profile_id", profile.id).maybeSingle();
        if (existingSource && existingConsent) {
          return json(200, { paymentMethod: existingSource, consentRecorded: true, duplicate: true });
        }
      }
      throw new PaymentError(409, "This saved payment request is already in progress; reconcile it before retrying.");
    }
    const paypal = new PayPalClient(env);
    const token = await paypal.exchangeVaultSetupToken(setupToken, requestId);
    if (!token.id || token.id.length > 200) {
      throw new PaymentError(502, "PayPal did not return a payment token.");
    }
    const consentHash = await digest(
      `${termsVersion}|${scope}|${requestedCategories.sort().join(",")}|${consentText}`,
    );
    const { data: source, error: sourceError } = await db.from("paypal_payment_sources")
      .insert({
        profile_id: profile.id,
        environment: paypal.environment,
        vault_token: token.id,
        payer_reference: token.customer?.id ?? null,
      })
      .select("id,environment,status,created_at").single();
    if (sourceError || !source) {
      if (sourceError?.code === "23505") {
        throw new PaymentError(409, "This PayPal payment method is already saved.");
      }
      throw new PaymentError(503, "Saved payment method persistence failed.");
    }
    const { error: consentError } = await db.from("paypal_payment_consents").insert({
      payment_source_id: source.id,
      profile_id: profile.id,
      booking_id: bookingId ?? null,
      scope,
      categories: requestedCategories.sort(),
      agreement_id: agreementId,
      terms_version: termsVersion,
      consent_text_hash: consentHash,
    });
    if (consentError) throw new PaymentError(503, "Payment consent persistence failed.");
    const { error: requestUpdateError } = await db.from("paypal_vault_requests")
      .update({ payment_source_id: source.id }).eq("setup_token", setupToken).eq("profile_id", profile.id);
    if (requestUpdateError) throw new PaymentError(503, "Saved payment request reconciliation is required.");
    return json(200, { paymentMethod: source, consentRecorded: true });
  } catch (error) {
    return paymentFailure(error);
  }
});
