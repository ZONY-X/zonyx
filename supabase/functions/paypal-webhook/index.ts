import { reconcileRefund, type CancellationOperation } from "../_shared/paypal-operations.ts";
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
  let stage = "gate";
  try {
    if (env("PAYPAL_WEBHOOK_RECONCILIATION_ENABLED") !== "true") assertPayPalProviderLockReady(env);
    if (
      (env("PAYPAL_RENTAL_CHECKOUT_ENABLED") !== "true" && env("PAYPAL_WEBHOOK_RECONCILIATION_ENABLED") !== "true") ||
      !env("PAYPAL_WEBHOOK_ID")
    ) throw new PaymentError(503, "PayPal webhooks are disabled.");
    const raw = await request.text();
    if (raw.length > 100000) {
      throw new PaymentError(413, "Webhook payload is too large.");
    }
    const event = JSON.parse(raw);
    const paypal = new PayPalClient(env);
    stage = "signature";
    if (
      !await paypal.verifyWebhook(
        request.headers,
        event,
        env("PAYPAL_WEBHOOK_ID")!,
      )
    ) throw new PaymentError(400, "Invalid PayPal webhook signature.");
    stage = "identity";
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
      "PAYMENT.AUTHORIZATION.EXPIRED",
      "PAYMENT.CAPTURE.REFUND.PENDING",
      "PAYMENT.CAPTURE.REFUND.FAILED",
    ];
    if (!events.includes(event.event_type)) {
      return json(200, { received: true });
    }
    let orderId = event.resource?.supplementary_data?.related_ids?.order_id ||
      (event.event_type.startsWith("CHECKOUT.ORDER.")
        ? event.resource?.id
        : undefined);
    const db = serviceClient();
    let refundPayment: Payment | undefined;
    if (!orderId && event.event_type.includes("REFUND") && typeof event.resource?.id === "string") {
      const refund = await paypal.getRefund(event.resource.id);
      const bases = paypal.environment === "sandbox" ? ["https://api-m.sandbox.paypal.com","https://api.sandbox.paypal.com"] : ["https://api-m.paypal.com","https://api.paypal.com"];
      const up = refund.links?.find(link=>link.rel==="up");
      const captureBase = bases.find(base=>up?.href.startsWith(base+"/v2/payments/captures/"));
      const captureId = refund.supplementary_data?.related_ids?.capture_id || (captureBase ? up!.href.slice((captureBase+"/v2/payments/captures/").length) : undefined);
      if (captureId && /^[A-Za-z0-9]+$/.test(captureId)) {
        const lookup = await db.from("booking_payments").select("*").eq("provider","paypal").eq("environment",paypal.environment).eq("capture_id",captureId).maybeSingle();
        if(lookup.error) throw new PaymentError(503,"Refund lookup unavailable; redelivery required.");
        refundPayment=lookup.data as Payment; orderId=refundPayment?.order_id;
      }
    }
    if (!orderId || typeof event.id !== "string") {
      throw new PaymentError(400, "Webhook order identity is missing.");
    }
    const { data: rental, error: rentalError } = await db.from("booking_payments").select("*").eq(
      "provider",
      "paypal",
    ).eq("environment", paypal.environment).eq("order_id", orderId)
      .maybeSingle();
    if(rentalError) throw new PaymentError(503,"Payment lookup unavailable; redelivery required.");
    let data = rental || refundPayment;
    let deposit: Deposit | undefined;
    if (!data) {
      const result = await db.from("booking_security_deposits").select("*").eq("provider","paypal").eq("provider_order_id",orderId).maybeSingle();
      if (result.error) throw new PaymentError(503,"Deposit lookup unavailable; redelivery required.");
      if (result.data) {
        deposit = result.data as Deposit;
        const paymentResult = await db.from("booking_payments").select("*").eq("id",deposit.rental_payment_id).eq("environment",paypal.environment).maybeSingle();
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
    stage = "receipt";
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
    stage = "canonical-state";
    if (deposit) {
      const order = await paypal.getOrder(orderId);
      const authorization = validateDepositOrder(order,deposit);
      if (!authorization) throw new PaymentError(409,"Canonical authorization unavailable; redelivery required.");
      const {data: operation,error: operationError} = await db.from("paypal_booking_operations").select("*").eq("payment_id",payment.id).maybeSingle();
      if(operationError) throw new PaymentError(503,"Operation lookup unavailable; redelivery required.");
      if (operation && ["VOIDED","EXPIRED"].includes(authorization.status)) {
        await rpc(db,"record_paypal_cancellation_void",{_operation_id:operation.id,_authorization_id:authorization.id,_status:authorization.status});
      } else if (["VOIDED","EXPIRED"].includes(authorization.status) || Date.parse(authorization.create_time)+3*86400000<=Date.now()) {
        await rpc(db,"refresh_paypal_deposit_coverage",{_deposit_id:deposit.id,_authorization_id:authorization.id,_provider_status:authorization.status,_expires_at:authorization.expiration_time});
      } else if(!operation) {
        await persistDepositAuthorization(db,payment,deposit,order);
      }
    } else if (
      ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "PAYMENT.CAPTURE.REFUND.PENDING", "PAYMENT.CAPTURE.REFUND.FAILED"].includes(
        event.event_type,
      )
    ) {
      const {data: operation,error: operationError} = await db.from("paypal_booking_operations").select("*").eq("payment_id",payment.id).maybeSingle();
      if(operationError) throw new PaymentError(503,"Refund operation lookup unavailable; redelivery required.");
      if(operation && event.event_type!=="PAYMENT.CAPTURE.REVERSED") {
        if(typeof event.resource?.id!=="string") throw new PaymentError(409,"Refund identity required.");
        const status=await reconcileRefund(db,paypal,operation as CancellationOperation,payment,event.resource.id);
        if(status==="COMPLETED") await rpc(db,"complete_paypal_cancellation",{_operation_id:operation.id});
      } else {
        // Unexpected external refund/reversal requires review, never resurrection.
        await rpc(db,"record_paypal_payment_state",{_payment_id:payment.id,_state:"reconciliation_required"});
      }
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
    console.warn(JSON.stringify({component:"paypal-webhook",stage,status:error instanceof PaymentError?error.status:500}));
    return paymentFailure(error);
  }
});
