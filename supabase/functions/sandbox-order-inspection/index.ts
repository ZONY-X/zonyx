// Read-only, exact-project inspection of synthetic sandbox orders. No PAN,
// credentials, SDK token, payer data or provider write is returned/performed.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PayPalClient } from "../_shared/paypal-client.ts";
import { authenticate, corsHeaders, env, json, validateBooking, type Payment, serviceClient, paymentFailure } from "../_shared/payment-service.ts";
import { PaymentError } from "../_shared/payment-policy.ts";

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    if (env("SUPABASE_URL") !== "https://pvowzjqimikcoyjwclez.supabase.co" || env("PAYPAL_ENVIRONMENT") !== "sandbox") throw new PaymentError(403, "Exact sandbox required.");
    const user = await authenticate(request);
    if (user.id !== "52af03eb-1976-4db0-900a-6509b1c8405b") throw new PaymentError(403, "Synthetic tester required.");
    const input = await request.json();
    if (Object.keys(input).length !== 1 || typeof input.paymentId !== "string") throw new PaymentError(400, "Payment identifier required.");
    const db = serviceClient();
    const { data } = await db.from("booking_payments").select("*").eq("id", input.paymentId).single();
    if (!data) throw new PaymentError(404, "Synthetic payment required.");
    const payment = data as Payment;
    await validateBooking(db, payment.booking_id, payment.agreement_id, user.id, true);
    if (payment.provider === "stripe" && payment.environment === "sandbox") {
      const key = env("STRIPE_SECRET_KEY");
      if (!key?.startsWith("sk_test_")) throw new PaymentError(403, "TEST credential required.");
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions?limit=100", { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) {
        const failure = await res.json();
        // Never return Stripe's message: invalid-key messages can echo a key.
        return json(502, { error: "Stripe TEST read unavailable", status: res.status, code: failure.error?.code, type: failure.error?.type });
      }
      const list: { data: { id: string; livemode: boolean; metadata?: { bookingId?: string }; status: string; payment_status: string; amount_total: number; currency: string; payment_intent: string | null; url: string | null }[] } = await res.json();
      return json(200, { paymentId: payment.id, persistedState: payment.state, sessions: list.data.filter((s) => s.livemode === false && s.metadata?.bookingId === payment.booking_id).map((s) => ({ id: s.id, status: s.status, paymentStatus: s.payment_status, amountCents: s.amount_total, currency: s.currency, captureId: s.payment_intent, url: s.status === "open" ? s.url : undefined })) });
    }
    if (payment.environment !== "sandbox" || !payment.order_id) throw new PaymentError(409, "Existing sandbox order required.");
    const paypal = new PayPalClient(env);
    const order = await paypal.getOrder(payment.order_id);
    const {data: operation} = await db.from("paypal_booking_operations").select("*").eq("payment_id",payment.id).maybeSingle();
    let refundEvidence;
    if(operation && payment.capture_id) {
      try {
        const id=operation.provider_refund_id || await paypal.findCancellationRefund(payment.capture_id,payment.order_id,operation.created_at);
        const refund=await paypal.getRefund(id);
        refundEvidence={id:refund.id,status:refund.status,amount:refund.amount,relatedIds:refund.supplementary_data?.related_ids,links:refund.links?.filter(link=>link.rel==='up')};
      }catch(error){refundEvidence={error:error instanceof PaymentError?error.message:"Canonical refund read unavailable."};}
    }
    const {data: deposit} = await db.from("booking_security_deposits").select("*").eq("rental_payment_id",payment.id).eq("generation",1).maybeSingle();
    const hold = deposit?.provider_order_id ? await new PayPalClient(env).getOrder(deposit.provider_order_id) : undefined;
    return json(200, {
      refundEvidence,
      deposit: hold ? {id:deposit.id,persistedStatus:deposit.status,orderId:hold.id,intent:hold.intent,status:hold.status,units:hold.purchase_units?.map(unit=>({referenceId:unit.reference_id,customId:unit.custom_id,amount:unit.amount,payments:{captures:unit.payments?.captures?.map(c=>({id:c.id,status:c.status,amount:c.amount})),authorizations:unit.payments?.authorizations?.map(a=>({id:a.id,status:a.status,amount:a.amount,createdAt:a.create_time,expiresAt:a.expiration_time}))}})),authentication:hold.payment_source?.card?.authentication_result}:undefined,
      paymentId: payment.id, persistedState: payment.state,
      orderId: order.id, intent: order.intent, status: order.status,
      units: order.purchase_units?.map(unit => ({ referenceId: unit.reference_id, customId: unit.custom_id, amount: unit.amount, captures: unit.payments?.captures?.map(capture => ({ id: capture.id, status: capture.status, amount: capture.amount })) })),
      authentication: order.payment_source?.card?.authentication_result,
    });
  } catch (error) { return paymentFailure(error); }
});
