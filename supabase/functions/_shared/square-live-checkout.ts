import { env, json, rpc, validateRentalEligibility, type DB, type Payment } from "./payment-service.ts";
import { PaymentError } from "./payment-policy.ts";
import { squareSetting, squareDepositTiming } from "./square-policy.ts";
import { SquareClient, SquareCardDeclined } from "./square-client.ts";
import { squareBooking, squareOwned, squarePreflight, squareRecord, squareStatus } from "./square-service.ts";

type Input = {action:string;bookingId?:string;agreementId?:string;paymentId?:string;token?:string};
// Returns null for existing hold-first payments; their recovery contract stays intact.
export async function squareLiveCheckout(request:Request, db:DB, userId:string, input:Input):Promise<Response|null> {
  if (input.action === "status") return json(200, await squareStatus(db, new SquareClient(env), await squareOwned(db,input.paymentId!,userId)));
  if (!["config","rental","hold"].includes(input.action)) throw new PaymentError(400,"Invalid Square checkout action.");
  const b = await squareBooking(db,input.bookingId!,input.agreementId!,userId);
  let {data:existing,error} = await db.from("booking_payments").select("*").eq("booking_id",b.id).maybeSingle();
  if (error) throw new PaymentError(503,"Existing payment lookup unavailable.");
  if (existing && (existing.provider !== "square" || existing.environment !== "live" || existing.agreement_id !== input.agreementId)) throw new PaymentError(409,"This booking is locked to its existing provider and agreement.");
  let operation:{checkout_sequence:string;cancel_requested:boolean;current_hold_attempt?:string}|undefined;
  if(existing) {
    const {data,error} = await db.from("square_payment_operations").select("*").eq("payment_id",existing.id).single();
    if(error || !data) throw new PaymentError(503,"Existing Square operation unavailable.");
    operation=data;
    if(operation!.checkout_sequence !== "rental_then_hold") return null;
  }
  if(input.action === "config" && existing?.state === "reconciliation_required" &&
     existing.paid_at && existing.capture_id && !operation?.cancel_requested) {
    // Reconcile the already captured rental against Square before offering a deposit-only retry.
    // squareStatus uses canonical provider evidence; it never creates another rental charge.
    await squareStatus(db,new SquareClient(env),existing as Payment);
    const refreshed=await db.from("booking_payments").select("*").eq("id",existing.id).single();
    if(refreshed.error || !refreshed.data) throw new PaymentError(503,"Square rental recovery unavailable.");
    existing=refreshed.data;
  }
  if(input.action === "config") {
    if(!existing || existing.state === "paid") {
      await validateRentalEligibility(request,db,b);
    }
    const timing=squareDepositTiming(await rpc<string>(db,"paypal_trip_inspection_deadline",{_booking_id:b.id}));
    let attempt:{state:string}|null=null;
    if(operation?.current_hold_attempt) {
      const {data,error} = await db.from("square_deposit_attempts").select("state").eq("id",operation.current_hold_attempt).single();
      if(error || !data) throw new PaymentError(503,"Deposit attempt unavailable.");
      attempt=data;
    }
    return json(200,{environment:"live",checkoutSequence:"rental_then_hold",applicationId:squareSetting(env,"APPLICATION_ID"),locationId:squareSetting(env,"LOCATION_ID"),amountCents:b.grand_total_cents,depositAmountCents:b.depositAmountCents,existingPayment:existing,...timing,
      canPayRental:!existing,canAuthorizeDeposit:!timing.depositDeferred && existing?.state === "paid" && !!existing.paid_at && !!existing.capture_id && b.trip_status === "pending_payment" && !operation?.cancel_requested && (!attempt || attempt.state === "failed")});
  }
  if(typeof input.token !== "string" || !input.token.startsWith("cnon:")) throw new PaymentError(400,"A fresh Square card token is required.");
  const client=new SquareClient(env);
  if(input.action === "rental") {
    // An existing rental is never dispatched again, even after a lost response.
    if(existing) return json(200,await squareStatus(db,client,existing as Payment));
    await validateRentalEligibility(request,db,b);
    const prepared=await rpc<{payment:Payment;dispatch:boolean}>(db,"prepare_square_live_checkout",{_booking_id:b.id,_agreement_id:input.agreementId,_user_id:userId});
    if(prepared.dispatch) {
      const created=await client.create({token:input.token,key:prepared.payment.capture_request_id,reference:prepared.payment.id,amount:prepared.payment.amount_cents,hold:false});
      await squareRecord(db,client,prepared.payment,false,await client.get(created.id));
    }
    return json(200,await squareStatus(db,client,prepared.payment));
  }
  if(!existing || input.paymentId !== existing.id) throw new PaymentError(409,"Verified rental payment required before deposit.");
  const p=await squareOwned(db,existing.id,userId);
  await squareStatus(db,client,p);
  await squarePreflight(request,db,b);
  const claimed=await rpc<{attempt:{id:string};dispatch:boolean}>(db,"claim_square_deposit_attempt",{_payment_id:p.id,_user_id:userId});
  if(claimed.dispatch) {
    try {
      const created=await client.create({token:input.token,key:claimed.attempt.id,reference:claimed.attempt.id,amount:b.depositAmountCents,hold:true});
      await squareRecord(db,client,p,true,await client.get(created.id));
    } catch(error) {
      if(!(error instanceof SquareCardDeclined)) throw error;
      await rpc(db,"record_square_deposit_attempt",{_payment_id:p.id,_attempt_id:claimed.attempt.id,_provider_id:null,_status:"FAILED",_amount:b.depositAmountCents,_expires:null});
    }
  }
  return json(200,await squareStatus(db,client,p));
}
