import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, env, json, paymentFailure, rpc, serviceClient } from "../_shared/payment-service.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import { assertSquareSandbox } from "../_shared/square-policy.ts";
import { SquareClient } from "../_shared/square-client.ts";
import { squareUser, squareOwned, squareRecord, squareStatus } from "../_shared/square-service.ts";
serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    assertSquareSandbox(env, "SQUARE_OPERATIONS_ENABLED");
    const user = await squareUser(request), input = await request.json();
    if (!input || Object.keys(input).some(k => !["action", "paymentId", "reason"].includes(k)) || !["cancel", "status"].includes(input.action)) throw new PaymentError(400, "Invalid Square operation.");
    const db = serviceClient(); let p = await squareOwned(db, input.paymentId, user.id); const client = new SquareClient(env, fetch, "SQUARE_OPERATIONS_ENABLED");
    await squareStatus(db, client, p);
    p = await squareOwned(db, p.id, user.id);
    const { data: pending, error: pendingError } = await db.from("square_payment_operations").select("cancel_requested").eq("payment_id", p.id).single();
    if (pendingError || !pending) throw new PaymentError(503, "Square cancellation state unavailable.");
    if (input.action === "cancel" || pending.cancel_requested) {
      if (input.action === "cancel") await rpc(db, "claim_square_step", { _payment_id: p.id, _step: "cancel", _user_id: user.id, _reason: input.reason });
      const voidClaim = await rpc<{dispatch:boolean;deposit:{provider_authorization_id:string;status:string}}>(db, "claim_square_step", { _payment_id: p.id, _step: "void", _user_id: user.id });
      if (voidClaim.deposit.provider_authorization_id && (voidClaim.dispatch || voidClaim.deposit.status === "authorized")) await client.void(voidClaim.deposit.provider_authorization_id);
      if (voidClaim.deposit.provider_authorization_id) await squareRecord(db, client, p, true, await client.get(voidClaim.deposit.provider_authorization_id));
      if (p.capture_id) {
        const claim = await rpc<{dispatch:boolean;operation:{refund_key:string;refund_amount_cents:number;refund_id?:string}}>(db, "claim_square_step", { _payment_id: p.id, _step: "refund", _user_id: user.id });
        if (claim.dispatch) {
          const refund = await client.refund(p.capture_id, claim.operation.refund_key, claim.operation.refund_amount_cents);
          await recordRefund(await client.getRefund(refund.id));
        } else if (!claim.operation.refund_id) {
          const { data: original, error: originalError } = await db.from("booking_payments").select("created_at").eq("id", p.id).single();
          if (originalError || !original) throw new PaymentError(503, "Refund recovery state unavailable.");
          const recovered = await client.findRefund(p.capture_id, claim.operation.refund_key, original.created_at);
          if (recovered) await recordRefund(recovered);
        }
      }
    }
    const { data: initialOperation, error } = await db.from("square_payment_operations").select("*").eq("payment_id", p.id).single();
    if (error || !initialOperation) throw new PaymentError(503, "Square operation status unavailable.");
    if (initialOperation.refund_id) await recordRefund(await client.getRefund(initialOperation.refund_id));
    const { data: operation, error: refreshError } = await db.from("square_payment_operations").select("*").eq("payment_id", p.id).single();
    if (refreshError || !operation) throw new PaymentError(503, "Square operation status unavailable.");
    p = await squareOwned(db, p.id, user.id);
    if (operation.cancel_requested && (!operation.rental_started || (p.state === "failed" && !!p.order_id && !p.capture_id) || operation.refund_status === "COMPLETED")) {
      await rpc(db, "complete_square_cancellation", {_payment_id:p.id});
    }
    return json(200, { ok: true, ...await squareStatus(db, client, p), refundStatus: operation.refund_status, operationState: operation.cancel_requested && (!operation.rental_started || (p.state === "failed" && !!p.order_id && !p.capture_id) || operation.refund_status === "COMPLETED") ? "complete" : "reconciliation_required" });
    async function recordRefund(refund: {id:string;payment_id:string;amount_money:{amount:number;currency:string};status:string;location_id:string}) {
      if (refund.amount_money?.currency !== "USD" || refund.location_id !== client.location) throw new PaymentError(409, "Refund currency or location conflicts.");
      await rpc(db, "record_square_refund", { _payment_id: p.id, _id: refund.id, _rental_id: refund.payment_id, _amount: refund.amount_money.amount, _status: refund.status });
    }
  } catch (error) { return paymentFailure(error); }
});
