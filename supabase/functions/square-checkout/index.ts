import {loadPaymentRentalAgreement} from '../_shared/payment-rental-agreement.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, env, json, paymentFailure, rpc, serviceClient, type Payment } from "../_shared/payment-service.ts";
import { PaymentError } from "../_shared/payment-policy.ts";
import { assertSquareSandbox, squareSetting } from "../_shared/square-policy.ts";
import { SquareClient } from "../_shared/square-client.ts";
import { squareUser, squareBooking, squareOwned, squarePreflight, squareRecord, squareStatus } from "../_shared/square-service.ts";
import { squareLiveCheckout } from "../_shared/square-live-checkout.ts";
serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  try {
    assertSquareSandbox(env); // OFF stops before credentials, auth, database or provider access.
    const user = await squareUser(request);
    const input = await request.json();
    if (!input || Object.keys(input).some(k => !["action", "bookingId", "agreementId", "paymentId", "token", "documentHash", "agreementAccepted"].includes(k))) throw new PaymentError(400, "Unsupported checkout fields.");
    const db = serviceClient();
    if (env("SQUARE_ENVIRONMENT") === "live" && ["agreementDetails","acceptAgreement","rental","hold"].includes(input.action)) {
      let bookingId=input.bookingId, agreementId=input.agreementId;
      if(!bookingId && input.paymentId){const payment=await squareOwned(db,input.paymentId,user.id);bookingId=payment.booking_id;agreementId=payment.agreement_id;}
      await squareBooking(db,bookingId,agreementId,user.id);
      const agreement=await loadPaymentRentalAgreement(db,bookingId);
      const {data:accepted,error:lookupError}=await db.from("payment_rental_addendum_acceptances").select("id").eq("booking_id",bookingId).eq("guest_auth_user_id",user.id).eq("document_hash",agreement.document_hash).maybeSingle();
      if(lookupError)throw new PaymentError(503,"Rental Agreement acceptance verification unavailable.");
      if(input.action==="agreementDetails")return json(200,{...agreement,acceptance_required:agreement.is_addendum&&!accepted});
      if(input.action==="acceptAgreement"){
        if(input.agreementAccepted!==true||input.documentHash!==agreement.document_hash)throw new PaymentError(409,"Review and explicitly accept the current Rental Agreement addendum.");
        if(agreement.is_addendum&&!accepted){
          const {error}=await db.from("payment_rental_addendum_acceptances").insert({booking_id:bookingId,agreement_id:agreement.agreement_id,version_id:agreement.version_id,agreement_version:agreement.version,source_revision_id:agreement.source_revision_id,source_document_hash:agreement.source_revision_hash,document_hash:agreement.document_hash,rendered_text:agreement.rendered_text,consent_text:"I have reviewed and accept the Early Termination Addendum to my Rental Agreement.",guest_auth_user_id:user.id,accepted_ip:request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||null,accepted_user_agent:request.headers.get("user-agent")||""});
          if(error&&error.code!=="23505")throw new PaymentError(503,"Agreement acceptance could not be recorded. No payment was submitted.");
        }
        return json(200,{accepted:true,documentHash:agreement.document_hash});
      }
      // Deposit-only recovery after a captured rental retains its existing behavior.
      const {data:paid,error:paymentError}=await db.from("booking_payments").select("paid_at,capture_id").eq("booking_id",bookingId).maybeSingle();
      if(paymentError)throw new PaymentError(503,"Payment state unavailable.");
      if(!(paid?.paid_at&&paid?.capture_id)&&agreement.is_addendum&&!accepted)throw new PaymentError(409,"Review and accept the Rental Agreement addendum before paying.");
    }
    if (env("SQUARE_ENVIRONMENT") === "live") {
      const response = await squareLiveCheckout(request,db,user.id,input);
      if(response) return response;
    }
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
      if (!existing || canPayRental || input.action === "hold") {
        try { await squarePreflight(request, db, b); }
        catch (error) {
          if (input.action === "config" && env("SQUARE_ENVIRONMENT") === "live" && error instanceof PaymentError && error.status === 409 && error.message.startsWith("Deposit coverage cannot protect"))
            return json(200, { environment: "live", manualDepositRequired: true, existingPayment: existing });
          throw error;
        }
      }
      if (input.action === "config") return json(200, { canPayRental, environment: env("SQUARE_ENVIRONMENT"), applicationId: squareSetting(env, "APPLICATION_ID"), locationId: squareSetting(env, "LOCATION_ID"), amountCents: b.grand_total_cents, depositAmountCents: b.depositAmountCents, existingPayment: existing });
      if (typeof input.token !== "string" || !input.token.startsWith("cnon:")) throw new PaymentError(400, "A fresh Square card token is required.");
      const client = new SquareClient(env);
      const prepared = await rpc<{payment: Payment; deposit: {id:string;amount_cents:number};dispatch:boolean}>(db, env("SQUARE_ENVIRONMENT") === "live" ? "prepare_square_live_payment" : "prepare_square_payment", { _booking_id: input.bookingId, _agreement_id: input.agreementId, _user_id: user.id });
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
