import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, env, json, paymentFailure, rpc, serviceClient, type Payment } from "../_shared/payment-service.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import { assertSquareSandbox } from "../_shared/square-policy.ts";
import { SquareClient } from "../_shared/square-client.ts";
import { squareUser, squareBooking, squareOwned, squarePreflight, squareRecord, squareStatus } from "../_shared/square-service.ts";
serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    assertSquareSandbox(env); // OFF stops before credentials, auth, database or provider access.
    const user = await squareUser(request);
    const input = await request.json();
    if (!input || Object.keys(input).some(k => !["action", "bookingId", "agreementId", "paymentId", "token"].includes(k))) throw new PaymentError(400, "Unsupported checkout fields.");
    const db = serviceClient();
    if (input.action === "config" || input.action === "hold") {
      const b = await squareBooking(db, input.bookingId, input.agreementId, user.id);

      const { data: existing, error } = await db.from("booking_payments").select("id,provider,state").eq("booking_id", input.bookingId).maybeSingle();
      if (error) throw new PaymentError(503, "Existing payment lookup unavailable.");
      if (existing && existing.provider !== "square") throw new PaymentError(409, "This booking is locked to its existing provider.");
      let canPayRental = false;
      if (existing) {
        const { data: operation, error: operationError } = await db.from("square_payment_operations").select("rental_started,cancel_requested").eq("payment_id", existing.id).single();
        const { data: deposit, error: depositError } = await db.from("booking_security_deposits").select("status,expires_at").eq("rental_payment_id", existing.id).eq("generation", 1).single();
        if (operationError || depositError) throw new PaymentError(503, "Existing Square state unavailable.");
        canPayRental = b.trip_status === "pending_payment" && Date.parse(deposit.expires_at) >= Date.parse(await rpc<string>(db, "paypal_trip_inspection_deadline", { _booking_id: b.id })) && !operation.rental_started && !operation.cancel_requested && deposit.status === "authorized" && Date.parse(deposit.expires_at) > Date.now();
      }
      if (!existing || canPayRental || input.action === "hold") await squarePreflight(request, db, b);
      if (input.action === "config") return json(200, { canPayRental, applicationId: env("SQUARE_SANDBOX_APPLICATION_ID"), locationId: env("SQUARE_SANDBOX_LOCATION_ID"), amountCents: b.grand_total_cents, depositAmountCents: b.depositAmountCents, existingPayment: existing });
      if (typeof input.token !== "string" || !input.token.startsWith("cnon:")) throw new PaymentError(400, "A fresh Square card token is required.");
      const client = new SquareClient(env);
      const prepared = await rpc<{payment: Payment; deposit: {id:string;amount_cents:number};dispatch:boolean}>(db, "prepare_square_payment", { _booking_id: input.bookingId, _agreement_id: input.agreementId, _user_id: user.id });
      if (!prepared.dispatch) return json(200, await squareStatus(db, client, prepared.payment));
      const created = await client.create({ token: input.token, key: prepared.payment.create_request_id, reference: prepared.deposit.id, amount: prepared.deposit.amount_cents, hold: true });
      await squareRecord(db, client, prepared.payment, true, await client.get(created.id));
      return json(200, await squareStatus(db, client, prepared.payment));
    }
    const p = await squareOwned(db, input.paymentId, user.id);
    const client = new SquareClient(env);
    if (input.action === "status") return json(200, await squareStatus(db, client, p));
    if (input.action !== "rental" || typeof input.token !== "string" || !input.token.startsWith("cnon:")) throw new PaymentError(400, "Invalid rental action or card token.");
    await squareStatus(db, client, p); // Canonical hold evidence before dispatch claim.
    const { data: operation, error: operationError } = await db.from("square_payment_operations").select("rental_started").eq("payment_id", p.id).single();
    if (operationError || !operation) throw new PaymentError(503, "Square rental state unavailable.");
    if (operation.rental_started) return json(200, await squareStatus(db, client, p));
    const b = await squareBooking(db, p.booking_id, p.agreement_id, user.id);
    await squarePreflight(request, db, b);
    const claimed = await rpc<{dispatch:boolean}>(db, "claim_square_step", { _payment_id: p.id, _step: "rental", _user_id: user.id });
    if (!claimed.dispatch) return json(200, await squareStatus(db, client, p));
    const rental = await client.create({ token: input.token, key: p.capture_request_id, reference: p.id, amount: p.amount_cents, hold: false });
    await squareRecord(db, client, p, false, await client.get(rental.id));
    return json(200, await squareStatus(db, client, await squareOwned(db, p.id, user.id)));
  } catch (error) { return paymentFailure(error); }
});
