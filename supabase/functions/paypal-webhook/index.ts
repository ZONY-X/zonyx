import { type Deposit, persistDepositAuthorization, validateDepositOrder } from "../_shared/paypal-deposit.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PayPalClient } from "../_shared/paypal-client.ts";
import { assertPayPalProviderLockReady, PaymentError } from "../_shared/payment-policy.ts";
import {
  env,
  json,
  type Payment,
  paymentFailure,
  persistOrderOutcome,
  rpc,
  serviceClient,
} from "../_shared/payment-service.ts";

serve(async (request) => {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }
  try {
    assertPayPalProviderLockReady(env);
    if (
      env("PAYPAL_RENTAL_CHECKOUT_ENABLED") !== "true" ||
      !env("PAYPAL_WEBHOOK_ID")
    ) throw new PaymentError(503, "PayPal webhooks are disabled.");
    const raw = await request.text();
    if (raw.length > 100000) {
      throw new PaymentError(413, "Webhook payload is too large.");
    }
    const event = JSON.parse(raw);
    const paypal = new PayPalClient(env);
    if (
      !await paypal.verifyWebhook(
        request.headers,
        event,
        env("PAYPAL_WEBHOOK_ID")!,
      )
    ) throw new PaymentError(400, "Invalid PayPal webhook signature.");
    const events = [
      "CHECKOUT.ORDER.APPROVED",
      "CHECKOUT.ORDER.COMPLETED",
      "PAYMENT.CAPTURE.COMPLETED",
      "PAYMENT.CAPTURE.PENDING",
      "PAYMENT.CAPTURE.DENIED",
      "PAYMENT.CAPTURE.REFUNDED",
      "PAYMENT.CAPTURE.REVERSED",
      "PAYMENT.AUTHORIZATION.CREATED",
      "PAYMENT.AUTHORIZATION.VOIDED",
    ];
    if (!events.includes(event.event_type)) {
      return json(200, { received: true });
    }
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id ||
      (event.event_type.startsWith("CHECKOUT.ORDER.")
        ? event.resource?.id
        : undefined);
    if (!orderId || typeof event.id !== "string") {
      throw new PaymentError(400, "Webhook order identity is missing.");
    }
    const db = serviceClient();
    const { data: rental } = await db.from("booking_payments").select("*").eq(
      "provider",
      "paypal",
    ).eq("environment", paypal.environment).eq("order_id", orderId)
      .maybeSingle();
    let data = rental;
    let deposit: Deposit | undefined;
    if (!data && paypal.environment === "sandbox" && env("PAYPAL_SANDBOX_DEPOSIT_ENABLED") === "true") {
      const result = await db.from("booking_security_deposits").select("*").eq("provider","paypal").eq("provider_order_id",orderId).maybeSingle();
      if (result.error) throw new PaymentError(503,"Deposit lookup unavailable; redelivery required.");
      if (result.data) {
        deposit = result.data as Deposit;
        const paymentResult = await db.from("booking_payments").select("*").eq("id",deposit.rental_payment_id).eq("environment","sandbox").maybeSingle();
        if (paymentResult.error) throw new PaymentError(503,"Rental lookup unavailable; redelivery required.");
        data = paymentResult.data;
      }
    }
    // Unknown events can arrive before order persistence: request redelivery.
    if (!data) {
      throw new PaymentError(
        409,
        "Webhook payment is not yet available for reconciliation.",
      );
    }
    const payment = data as Payment;
    const { data: seen, error: seenError } = await db.from(
      "payment_webhook_receipts",
    ).select("event_id").eq("provider", "paypal").eq(
      "environment",
      paypal.environment,
    ).eq("event_id", event.id).maybeSingle();
    if (seenError) {
      throw new PaymentError(503, "Webhook receipt lookup failed.");
    }
    if (seen) return json(200, { received: true });
    if (deposit) {
      const order = await paypal.getOrder(orderId);
      const authorization = validateDepositOrder(order,deposit);
      if (authorization?.status === "VOIDED") {
        await rpc(db,"record_paypal_sandbox_deposit_void",{_deposit_id:deposit.id,_order_id:orderId,_authorization_id:authorization.id});
      } else {
        await persistDepositAuthorization(db,payment,deposit,order);
      }
    } else if (
      ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(
        event.event_type,
      )
    ) {
      // Preserve immutable paid receipt; flag external changes for review. No
      // automatic refund, status rollback, booking confirmation, or money move.
      await rpc(db, "record_paypal_payment_state", {
        _payment_id: payment.id,
        _state: "reconciliation_required",
      });
    } else {
      await persistOrderOutcome(db, payment, await paypal.getOrder(orderId));
    }
    const { error } = await db.from("payment_webhook_receipts").upsert({
      provider: "paypal",
      environment: paypal.environment,
      event_id: event.id,
      payment_id: payment.id,
      event_type: event.event_type,
    }, { onConflict: "provider,environment,event_id", ignoreDuplicates: true });
    if (error) {
      throw new PaymentError(
        503,
        "Webhook persistence failed; redelivery is required.",
      );
    }
    return json(200, { received: true });
  } catch (error) {
    return paymentFailure(error);
  }
});
