import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { env, json, paymentFailure, rpc, serviceClient, type Payment } from "../_shared/payment-service.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import { assertSquareSandbox, squareSetting, verifySquareSignature } from "../_shared/square-policy.ts";
import { SquareClient } from "../_shared/square-client.ts";
import { squareRenewalEvidence } from "../_shared/square-renewal.ts";
import { squareRecord } from "../_shared/square-service.ts";
serve(async request => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    assertSquareSandbox(env, "SQUARE_WEBHOOK_ENABLED");
    const body = await request.text();
    if (body.length > 1000000 || !await verifySquareSignature(body, request.headers.get("x-square-hmacsha256-signature") || "", squareSetting(env, "WEBHOOK_SIGNATURE_KEY") || "", squareSetting(env, "WEBHOOK_URL") || "")) throw new PaymentError(400, "Invalid Square webhook signature.");
    const event = JSON.parse(body);
    if (!squareSetting(env, "MERCHANT_ID") || event.merchant_id !== squareSetting(env, "MERCHANT_ID") || !event.event_id) throw new PaymentError(400, "Square event merchant or identity mismatch.");
    if (!["payment.created", "payment.updated", "refund.created", "refund.updated"].includes(event.type)) return json(200, { ignored: true });
    const db = serviceClient();
    const { data: seen, error: receiptError } = await db.from("payment_webhook_receipts").select("event_id").eq("provider", "square").eq("environment", env("SQUARE_ENVIRONMENT")).eq("event_id", event.event_id).maybeSingle();
    if (receiptError) throw new PaymentError(503, "Webhook receipt lookup unavailable.");
    if (seen) return json(200, { duplicate: true });
    const client = new SquareClient(env, fetch, "SQUARE_WEBHOOK_ENABLED");
    const isRefund = event.type.startsWith("refund.");
    const canonicalRefund = isRefund ? await client.getRefund(event.data?.object?.refund?.id) : null;
    const canonical = await client.get(isRefund ? canonicalRefund.payment_id : event.data?.object?.payment?.id);
    if (!/^[0-9a-f-]{36}$/.test(canonical.reference_id)) throw new PaymentError(409, "Unknown Square reference requires reconciliation.");
    const {data:renewal,error:renewalError}=await db.from("square_renewal_payment_attempts").select("*").eq("id",canonical.reference_id).maybeSingle();
    if(renewalError)throw new PaymentError(503,"Renewal lookup unavailable.");
    if(renewal){
      if(isRefund)throw new PaymentError(409,"Renewal refund requires separate reconciliation.");
      await rpc(db,"record_square_renewal_payment",squareRenewalEvidence(canonical,renewal));
      return json(200,{ok:true,renewal:true});
    }
    // Durable reference permits recovery after a lost CreatePayment response.
    const { data: deposit, error: depositError } = await db.from("booking_security_deposits").select("rental_payment_id").eq("id", canonical.reference_id).eq("provider", "square").maybeSingle();
    if (depositError) throw new PaymentError(503, "Deposit lookup unavailable.");
    let attempt: {payment_id:string}|null=null;
    if(!deposit && env("SQUARE_ENVIRONMENT") === "live") {
      const {data,error} = await db.from("square_deposit_attempts").select("payment_id").eq("id",canonical.reference_id).maybeSingle();
      if(error) throw new PaymentError(503,"Deposit attempt lookup unavailable.");
      attempt=data;
    }
    const { data: p, error } = await db.from("booking_payments").select("*").eq("id", deposit?.rental_payment_id || attempt?.payment_id || canonical.reference_id).eq("provider", "square").eq("environment", env("SQUARE_ENVIRONMENT")).single();
    if (error || !p) throw new PaymentError(409, "Unknown Square payment; redelivery required.");
    await squareRecord(db, client, p as Payment, !!deposit || !!attempt, canonical);
    if (canonicalRefund) {
      if (deposit || attempt || canonicalRefund.location_id !== client.location || canonicalRefund.amount_money?.currency !== "USD") throw new PaymentError(409, "Unexpected Square refund requires reconciliation.");
      await rpc(db, "record_square_refund", { _payment_id: p.id, _id: canonicalRefund.id, _rental_id: canonicalRefund.payment_id, _amount: canonicalRefund.amount_money.amount, _status: canonicalRefund.status });
    }
    await rpc(db, "reconcile_square_booking", { _payment_id: p.id });
    const { error: receiptWrite } = await db.from("payment_webhook_receipts").upsert({ provider: "square", environment: env("SQUARE_ENVIRONMENT"), event_id: event.event_id, event_type: event.type, payment_id: p.id }, { onConflict: "provider,environment,event_id", ignoreDuplicates: true });
    if (receiptWrite) throw new PaymentError(503, "Webhook persistence failed; redelivery required.");
    return json(200, { ok: true });
  } catch (error) { return paymentFailure(error); }
});
