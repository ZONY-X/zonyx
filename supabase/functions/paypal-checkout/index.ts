import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PayPalClient } from "../_shared/paypal-client.ts";
import {
  assertPayPalProviderLockReady,
  approvalUrl,
  assertCardCaptureEligible,
  assertShortHoldCoverage,
  PaymentError,
  validatePayPalOrder,
} from "../_shared/payment-policy.ts";
import {
  authenticate,
  corsHeaders,
  env,
  json,
  ownedPayment,
  type Payment,
  paymentFailure,
  persistOrderOutcome,
  rpc,
  serviceClient,
  validateBooking,
  validateRentalEligibility,
} from "../_shared/payment-service.ts";

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }
  try {
    assertPayPalProviderLockReady(env);
    const user = await authenticate(request);
    const input = await request.json();
    if (
      !input ||
      Object.keys(input).some((key) =>
        !["action", "bookingId", "agreementId", "paymentId", "method"].includes(
          key,
        )
      )
    ) {
      throw new PaymentError(
        400,
        "Only booking and agreement identifiers are accepted.",
      );
    }
    const db = serviceClient();
    if (env("PAYPAL_RENTAL_CHECKOUT_ENABLED") !== "true") {
      throw new PaymentError(403, "PayPal checkout is disabled.");
    }
    if (["checkout-config", "client-token"].includes(input.action)) {
      const booking = await validateBooking(
        db,
        input.bookingId,
        input.agreementId,
        user.id,
      );
      const cardEnabled = env("PAYPAL_ADVANCED_CARD_ENABLED") === "true";
      const { data: existing, error: existingError } = await db.from(
        "booking_payments",
      ).select("id,state,checkout_method").eq("booking_id", input.bookingId).eq(
        "provider",
        "paypal",
      ).maybeSingle();
      if (existingError) {
        throw new PaymentError(503, "Existing payment status is unavailable.");
      }
      const paypal = new PayPalClient(env);
      return new Response(
        JSON.stringify({
          existingPayment: existing,
          clientToken: input.action === "client-token" && cardEnabled
            ? await paypal.browserClientToken()
            : undefined,
          cardEnabled,
          walletEnabled: false,
          depositEnabled: (paypal.environment === "sandbox" && env("SUPABASE_URL") === "https://pvowzjqimikcoyjwclez.supabase.co" && env("PAYPAL_SANDBOX_DEPOSIT_ENABLED") === "true") || (paypal.environment === "live" && env("PAYPAL_DEPOSIT_AUTHORIZATION_ENABLED") === "true"),
          amountCents: booking.grand_total_cents,
          currency: "USD",
          environment: paypal.environment,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    }
    if (input.action === "create") {
      const method = input.method ?? "card";
      if (method === "paypal_wallet") throw new PaymentError(403, "PayPal wallet checkout is not validated and is disabled.");
      if (!["card", "paypal_wallet"].includes(method)) {
        throw new PaymentError(400, "Payment method is unavailable.");
      }
      if (method === "card" && env("PAYPAL_ADVANCED_CARD_ENABLED") !== "true") {
        throw new PaymentError(403, "Embedded card payments are disabled.");
      }
      const booking = await validateBooking(
        db,
        input.bookingId,
        input.agreementId,
        user.id,
      );
      await validateRentalEligibility(request, db, booking);
      const deadline = await rpc<string>(db,"paypal_card_checkout_preflight",{_booking_id:input.bookingId});
      assertShortHoldCoverage(deadline);
      const paypal = new PayPalClient(env);
      const returnOrigin = new URL(env("PAYPAL_CHECKOUT_RETURN_ORIGIN") || "");
      if (
        returnOrigin.origin !== env("PAYPAL_CHECKOUT_RETURN_ORIGIN") ||
        (returnOrigin.protocol !== "https:" &&
          !(paypal.environment === "sandbox" &&
            ["localhost", "127.0.0.1"].includes(returnOrigin.hostname)))
      ) {
        throw new PaymentError(
          503,
          "A trusted checkout return origin must be configured.",
        );
      }
      const prepared = await rpc<{ payment: Payment; dispatch: boolean }>(
        db,
        "prepare_paypal_expanded_payment",
        {
          _booking_id: input.bookingId,
          _agreement_id: input.agreementId,
          _user_id: user.id,
          _environment: paypal.environment,
          _method: method,
        },
      );
      const payment = prepared.payment;
      if (!prepared.dispatch) {
        if (
          payment.state === "awaiting_approval" && payment.order_id &&
          (method === "card" || payment.approval_url)
        ) {
          return json(200, {
            provider: "paypal",
            url: payment.approval_url,
            orderId: payment.order_id,
            paymentId: payment.id,
          });
        }
        return json(409, {
          error:
            "An existing payment requires reconciliation. No new order was created.",
          paymentId: payment.id,
          state: payment.state,
        });
      }
      const returnUrl = new URL("/booking/paypal/return", returnOrigin);
      returnUrl.searchParams.set("payment_id", payment.id);
      const cancelUrl = new URL(returnUrl);
      cancelUrl.searchParams.set("cancelled", "true");
      // Claim is durable before HTTP. Unknown creation outcomes are never retried
      // automatically, including after PayPal's idempotency retention expires.
      const order = await paypal.createOrder({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: payment.id,
          custom_id: payment.id,
          invoice_id: payment.id,
          amount: {
            currency_code: "USD",
            value: (payment.amount_cents / 100).toFixed(2),
          },
        }],
        payment_source: method === "card"
          ? {
            card: {
              attributes: { verification: { method: "SCA_ALWAYS" } },
              experience_context: { shipping_preference: "NO_SHIPPING" },
            },
          }
          : {
            paypal: {
              experience_context: {
                user_action: "PAY_NOW",
                shipping_preference: "NO_SHIPPING",
                return_url: returnUrl.toString(),
                cancel_url: cancelUrl.toString(),
              },
            },
          },
      }, payment.create_request_id);
      validatePayPalOrder(order, payment);
      const url = method === "card"
        ? null
        : approvalUrl(order, paypal.environment);
      await rpc(db, "attach_paypal_rental_order", {
        _payment_id: payment.id,
        _order_id: order.id,
        _approval_url: url,
      });
      return json(200, {
        provider: "paypal",
        url,
        orderId: order.id,
        paymentId: payment.id,
      });
    }
    if (
      !["capture", "cancel", "status"].includes(input.action) ||
      typeof input.paymentId !== "string"
    ) throw new PaymentError(400, "Invalid payment action.");
    const payment = await ownedPayment(db, input.paymentId, user.id);
    if (input.action === "cancel") {
      await rpc(db, "record_paypal_payment_state", {
        _payment_id: payment.id,
        _state: "cancelled",
      });
      return json(200, { state: "cancelled", bookingConfirmed: false });
    }
    if (payment.state === "paid") {
      const receipt = await rpc<Record<string, unknown>>(
        db,
        "get_provider_rental_payment_receipt",
        { _booking_id: payment.booking_id },
      );
      if (!receipt || receipt.provider !== "paypal" || receipt.state !== "paid") {
        throw new PaymentError(409, "Existing payment receipt requires reconciliation.");
      }
      // Recovery must report persisted deposit evidence, not the current flag
      // or a fabricated disabled status. It never sends another provider POST.
      return json(200, receipt);
    }
    if (!payment.order_id) {
      return json(409, {
        error: "Order creation outcome requires reconciliation.",
        state: payment.state,
      });
    }
    const paypal = new PayPalClient(env);
    if (paypal.environment !== payment.environment) {
      throw new PaymentError(409, "Payment environment mismatch.");
    }
    let order = await paypal.getOrder(payment.order_id);
    const capture = validatePayPalOrder(order, payment);
    if (capture || payment.state === "capturing" || input.action === "status") {
      return json(200, await persistOrderOutcome(db, payment, order));
    }
    if (payment.checkout_method !== "card") throw new PaymentError(403,"Unvalidated wallet capture is disabled.");
    // Hosted-card authentication can leave the canonical order CREATED until
    // capture. Its server-read 3DS evidence below authorizes this card path;
    // wallet orders still require the payer's APPROVED state.
    const captureStatusEligible = order.status === "APPROVED" ||
      (payment.checkout_method === "card" && order.status === "CREATED");
    if (payment.state !== "awaiting_approval" || !captureStatusEligible) {
      throw new PaymentError(409, "Order is not eligible for capture.");
    }
    if (payment.checkout_method === "card") {
      if (env("PAYPAL_ADVANCED_CARD_ENABLED") !== "true") {
        throw new PaymentError(403, "Embedded card capture is disabled.");
      }
      assertCardCaptureEligible(order);
    }
    const booking = await validateBooking(
      db,
      payment.booking_id,
      payment.agreement_id,
      user.id,
    );
    await validateRentalEligibility(request, db, booking);
    assertShortHoldCoverage(await rpc<string>(db,"paypal_card_checkout_preflight",{_booking_id:payment.booking_id}));
    // One database compare-and-set winner may send a capture request. Retries
    // only GET the existing order; no blind second capture request is possible.
    await rpc(db, "claim_paypal_rental_capture", {
      _payment_id: payment.id,
      _user_id: user.id,
    });
    await paypal.captureOrder(payment.order_id, payment.capture_request_id);
    // Read the complete canonical order after capture; sparse POST responses
    // are never accepted as sufficient amount/identity evidence.
    order = await paypal.getOrder(payment.order_id);
    return json(
      200,
      await persistOrderOutcome(db, { ...payment, state: "capturing" }, order),
    );
  } catch (error) {
    return paymentFailure(error);
  }
});
