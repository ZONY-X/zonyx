import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PayPalClient } from "../_shared/paypal-client.ts";
import { PaymentError, paypalCents } from "../_shared/payment-policy.ts";
import {
  authenticate,
  corsHeaders,
  env,
  json,
  paymentFailure,
  rpc,
  serviceClient,
} from "../_shared/payment-service.ts";

function assertEnabled() {
  if (env("PAYPAL_MIT_ENABLED") !== "true") {
    throw new PaymentError(503, "PayPal merchant-initiated charges are disabled.");
  }
  if (
    env("PAYPAL_ENVIRONMENT") === "live" &&
    env("PAYPAL_MIT_LIVE_ENABLED") !== "true"
  ) {
    throw new PaymentError(503, "PayPal merchant-initiated charges are not live-enabled.");
  }
}

async function assertAdmin(db: ReturnType<typeof serviceClient>, userId: string) {
  const { data: profile, error } = await db.from("profiles").select("id,is_admin")
    .eq("user_id", userId).maybeSingle();
  if (error || !profile?.is_admin) throw new PaymentError(403, "Administrator authorization required.");
}

async function captureOrder(
  db: ReturnType<typeof serviceClient>,
  paypal: PayPalClient,
  operation: Record<string, unknown>,
) {
  const operationId = String(operation.id);
  const { data: source, error: sourceError } = await db.from("paypal_payment_sources")
    .select("vault_token,status,environment").eq("id", operation.payment_source_id).maybeSingle();
  if (sourceError || !source || source.status !== "active" || source.environment !== paypal.environment) {
    throw new PaymentError(409, "Saved PayPal payment method requires reconciliation.");
  }
  const order = await paypal.createMerchantInitiatedOrder({
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: operationId,
      custom_id: operationId,
      invoice_id: operationId,
      amount: {
        currency_code: String(operation.currency).toUpperCase(),
        value: (Number(operation.amount_cents) / 100).toFixed(2),
      },
    }],
    payment_source: {
      card: {
        attributes: {
          vault: {
            id: source.vault_token,
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
          },
          stored_credential: {
            payment_initiator: "MERCHANT",
            usage: "SUBSEQUENT",
          },
        },
      },
    },
  }, String(operation.request_id));
  if (!order.id) throw new PaymentError(409, "PayPal MIT order identity is unavailable.");
  const { error: orderError } = await db.from("paypal_mit_operations")
    .update({ provider_order_id: order.id, state: "submitted", updated_at: new Date().toISOString() })
    .eq("id", operationId).eq("state", "dispatching");
  if (orderError) throw new PaymentError(503, "MIT order identity could not be persisted.");
  const captured = await paypal.captureOrder(order.id, String(operation.capture_request_id));
  if (!captured.id) throw new PaymentError(409, "PayPal MIT capture identity is unavailable.");
  const canonical = await paypal.getCapture(captured.id);
  if (
    canonical.id !== captured.id ||
    !canonical.amount ||
    canonical.amount.currency_code !== String(operation.currency).toUpperCase() ||
    paypalCents(canonical.amount.value) !== Number(operation.amount_cents)
  ) {
    throw new PaymentError(409, "PayPal MIT capture requires reconciliation.");
  }
  if (canonical.status !== "COMPLETED") {
    await rpc(db, "record_paypal_mit_capture", {
      _operation_id: operationId,
      _capture_id: canonical.id,
      _status: "reconciliation_required",
      _provider_order_id: order.id,
    });
    throw new PaymentError(409, "PayPal MIT capture is pending; reconcile before retrying.");
  }
  return rpc(db, "finalize_paypal_mit_operation", {
    _operation_id: operationId,
    _capture_id: canonical.id,
    _amount_cents: Number(operation.amount_cents),
    _currency: operation.currency,
  });
}

async function captureDeposit(
  db: ReturnType<typeof serviceClient>,
  paypal: PayPalClient,
  operation: Record<string, unknown>,
  finalCapture: boolean,
) {
  const captured = await paypal.captureAuthorization(
    String(operation.authorization_id),
    Number(operation.amount_cents),
    String(operation.currency),
    finalCapture,
    String(operation.capture_request_id),
  );
  if (!captured.id) throw new PaymentError(409, "PayPal deposit capture identity is unavailable.");
  const canonical = await paypal.getCapture(captured.id);
  if (
    canonical.id !== captured.id ||
    !["COMPLETED", "PENDING"].includes(canonical.status) ||
    !canonical.amount ||
    canonical.amount.currency_code !== String(operation.currency).toUpperCase() ||
    paypalCents(canonical.amount.value) !== Number(operation.amount_cents)
  ) {
    throw new PaymentError(409, "PayPal deposit capture requires reconciliation.");
  }
  if (canonical.status !== "COMPLETED") {
    await rpc(db, "record_paypal_mit_capture", {
      _operation_id: String(operation.id),
      _capture_id: canonical.id,
      _status: "reconciliation_required",
    });
    throw new PaymentError(409, "PayPal deposit capture is pending; reconcile before retrying.");
  }
  return rpc(db, "finalize_paypal_deposit_capture", {
    _operation_id: String(operation.id),
    _capture_id: canonical.id,
    _amount_cents: Number(operation.amount_cents),
    _currency: operation.currency,
    _final_capture: finalCapture,
  });
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    assertEnabled();
    const user = await authenticate(request, true);
    const db = serviceClient();
    await assertAdmin(db, user.id);
    const input = await request.json();
    if (!input || !["charge-after-trip", "capture-deposit", "status"].includes(input.action)) {
      throw new PaymentError(400, "Unsupported PayPal MIT action.");
    }

    if (input.action === "status") {
      if (typeof input.operationId !== "string") throw new PaymentError(400, "Operation identity is required.");
      const { data, error } = await db.from("paypal_mit_operations").select("*")
        .eq("id", input.operationId).maybeSingle();
      if (error || !data) throw new PaymentError(404, "MIT operation not found.");
      if (data.provider_capture_id) {
        const capture = await new PayPalClient(env).getCapture(data.provider_capture_id);
        if (capture.status === "COMPLETED") {
          if (data.operation_type === "deposit_capture") {
            const { data: deposit, error: depositError } = await db.from("booking_security_deposits")
              .select("amount_cents,captured_amount_cents").eq("id", data.deposit_id).maybeSingle();
            if (depositError || !deposit) throw new PaymentError(503, "Deposit reconciliation is unavailable.");
            await rpc(db, "finalize_paypal_deposit_capture", {
              _operation_id: data.id,
              _capture_id: data.provider_capture_id,
              _amount_cents: Number(data.amount_cents),
              _currency: data.currency,
              _final_capture: Number(data.amount_cents) === Number(deposit.amount_cents) - Number(deposit.captured_amount_cents),
            });
          } else {
            await rpc(db, "finalize_paypal_mit_operation", {
              _operation_id: data.id,
              _capture_id: data.provider_capture_id,
              _amount_cents: Number(data.amount_cents),
              _currency: data.currency,
            });
          }
        }
        return json(200, { operation: data, providerStatus: capture.status });
      }
      return json(200, { operation: data });
    }

    let operation: Record<string, unknown> | null = null;
    if (input.action === "charge-after-trip") {
      if (typeof input.chargeId !== "string" || typeof input.paymentSourceId !== "string") {
        throw new PaymentError(400, "Charge and saved payment method are required.");
      }
      const { data: charge, error: chargeError } = await db.from("after_trip_charges")
        .select("id,booking_id,category,amount_cents,currency,status,payment_status")
        .eq("id", input.chargeId).maybeSingle();
      if (chargeError || !charge || charge.status === "waived" || charge.status === "voided") {
        throw new PaymentError(409, "After-trip charge is not payable.");
      }
      const { data: booking, error: bookingError } = await db.from("bookings")
        .select("renter_profile_id").eq("id", charge.booking_id).maybeSingle();
      if (bookingError || !booking) throw new PaymentError(404, "Booking not found.");
      const { data: source, error: sourceError } = await db.from("paypal_payment_sources")
        .select("id,profile_id,vault_token,status,environment").eq("id", input.paymentSourceId)
        .maybeSingle();
      if (
        sourceError || !source || source.status !== "active" ||
        source.environment !== env("PAYPAL_ENVIRONMENT") ||
        source.profile_id !== booking.renter_profile_id
      ) {
        throw new PaymentError(409, "Saved PayPal payment method is unavailable.");
      }
      const { data: consent, error: consentError } = await db.from("paypal_payment_consents")
        .select("id,booking_id").eq("payment_source_id", source.id).eq("scope", "after_trip_charges")
        .contains("categories", [charge.category]).is("revoked_at", null).maybeSingle();
      if (
        consentError || !consent ||
        (consent.booking_id !== null && consent.booking_id !== charge.booking_id)
      ) {
        throw new PaymentError(409, "Explicit after-trip payment consent is required for this booking.");
      }
      const { data: existing } = await db.from("paypal_mit_operations").select("*")
        .eq("after_trip_charge_id", charge.id).maybeSingle();
      if (existing) operation = existing;
      else {
        const { data, error } = await db.from("paypal_mit_operations").insert({
          booking_id: charge.booking_id,
          payment_source_id: source.id,
          after_trip_charge_id: charge.id,
          operation_type: "after_trip_charge",
          amount_cents: charge.amount_cents,
          currency: charge.currency,
        }).select("*").single();
        if (error || !data) throw new PaymentError(503, "MIT operation could not be prepared.");
        operation = { ...data, vault_token: source.vault_token };
      }
    } else {
      if (typeof input.depositId !== "string" || !Number.isInteger(input.amountCents)) {
        throw new PaymentError(400, "Deposit and integer capture amount are required.");
      }
      const { data: deposit, error: depositError } = await db.from("booking_security_deposits")
        .select("*").eq("id", input.depositId).maybeSingle();
      if (depositError || !deposit || !["authorized", "partially_captured"].includes(deposit.status)) {
        throw new PaymentError(409, "Deposit is not capture-eligible.");
      }
      const remaining = Number(deposit.amount_cents) - Number(deposit.captured_amount_cents);
      if (input.amountCents <= 0 || input.amountCents > remaining) {
        throw new PaymentError(409, "Capture exceeds the remaining authorized balance.");
      }
      if (input.chargeId !== undefined) {
        const { data: charge, error: chargeError } = await db.from("after_trip_charges")
          .select("id,booking_id,amount_cents,status,payment_status")
          .eq("id", input.chargeId).maybeSingle();
        if (
          chargeError || !charge || charge.booking_id !== deposit.booking_id ||
          !["submitted", "pending_payment"].includes(charge.status) ||
          charge.payment_status === "paid" || Number(charge.amount_cents) !== input.amountCents
        ) {
          throw new PaymentError(409, "Deposit capture must match one unpaid documented after-trip charge.");
        }
      }
      const finalCapture = input.amountCents === remaining;
      const { data, error } = await db.from("paypal_mit_operations").insert({
        booking_id: deposit.booking_id,
        deposit_id: deposit.id,
        after_trip_charge_id: input.chargeId ?? null,
        operation_type: "deposit_capture",
        amount_cents: input.amountCents,
        currency: deposit.currency,
      }).select("*").single();
      if (error || !data) throw new PaymentError(503, "Deposit capture could not be prepared.");
      operation = {
        ...data,
        authorization_id: deposit.provider_authorization_id,
        final_capture: finalCapture,
      };
    }

    if (!operation) throw new PaymentError(503, "Payment operation was not prepared.");
    if (operation.state === "succeeded") return json(200, { operation });
    if (operation.state !== "prepared") {
      throw new PaymentError(409, "Existing PayPal operation requires reconciliation; no retry was sent.");
    }
    const claimed = await rpc<Record<string, unknown>>(db, "claim_paypal_mit_operation", {
      _operation_id: operation.id,
    });
    const paypal = new PayPalClient(env);
    const result = input.action === "charge-after-trip"
      ? await captureOrder(db, paypal, claimed)
      : await captureDeposit(db, paypal, {
        ...claimed,
        authorization_id: operation.authorization_id,
      }, operation.final_capture === true);
    return json(200, { operation: result });
  } catch (error) {
    return paymentFailure(error);
  }
});
