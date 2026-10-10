import { PayPalClient, type PayPalFinancialResource } from "./paypal-client.ts";
import { PaymentError, paypalCents } from "./payment-policy.ts";
import { type DB, type Payment, rpc } from "./payment-service.ts";
import { type Deposit, validateDepositOrder } from "./paypal-deposit.ts";
export type CancellationOperation = {
 id:string; payment_id:string; state:string; created_at:string; refund_amount_cents:number; currency:string;
 void_request_id:string; refund_request_id:string; provider_refund_id:string|null; refund_status:string|null;
};
export function validateRefund(refund:PayPalFinancialResource, operation:CancellationOperation, payment:Payment, environment:string) {
 const bases=environment==='sandbox'?['https://api-m.sandbox.paypal.com','https://api.sandbox.paypal.com']:['https://api-m.paypal.com','https://api.paypal.com'];
 const related=refund.supplementary_data?.related_ids?.capture_id;
 const up=refund.links?.find(link=>link.rel==='up');
 if (!refund.id || (operation.provider_refund_id && refund.id!==operation.provider_refund_id) ||
     refund.amount?.currency_code!==operation.currency.toUpperCase() || paypalCents(refund.amount?.value)!==Number(operation.refund_amount_cents) ||
     !(related===payment.capture_id || bases.some(base=>up?.href===`${base}/v2/payments/captures/${encodeURIComponent(payment.capture_id!)}`)) ||
     !['PENDING','COMPLETED','FAILED','CANCELLED'].includes(refund.status)) throw new PaymentError(409,'Refund identity or amount conflicts. Reconcile this existing refund.');
 return refund;
}
export async function reconcileRefund(db:DB,paypal:PayPalClient,operation:CancellationOperation,payment:Payment,refundId:string) {
 const refund=validateRefund(await paypal.getRefund(refundId),operation,payment,paypal.environment);
 if (!operation.provider_refund_id) await rpc(db,'attach_paypal_cancellation_refund',{_operation_id:operation.id,_refund_id:refund.id});
 await rpc(db,'record_paypal_cancellation_refund',{_operation_id:operation.id,_refund_id:refund.id,_capture_id:payment.capture_id,_amount_cents:Number(operation.refund_amount_cents),_currency:operation.currency,_status:refund.status});
 return refund.status;
}
export async function executeCancellation(db:DB,paypal:PayPalClient,payment:Payment,operation:CancellationOperation,deposit:Deposit,dispatch:boolean) {
 if (operation.state==='complete') return rpc(db,'complete_paypal_cancellation',{_operation_id:operation.id});
 // Canonical GET occurs before any write. A lost VOID response is recovered by
 // GET; claimed operations never send a second void/refund POST.
 if (['prepared','voiding'].includes(operation.state)) {
  const order=deposit.provider_order_id?await paypal.getOrder(deposit.provider_order_id):undefined;
  let authorization=order?validateDepositOrder(order,deposit):undefined;
  if (!authorization && deposit.provider_authorization_id) throw new PaymentError(409,'Existing authorization requires reconciliation.');
  if (authorization && authorization.status==='CREATED') {
   if (!dispatch || operation.state!=='prepared') throw new PaymentError(409,'Release outcome needs reconciliation. No retry was sent.');
   await rpc(db,'claim_paypal_cancellation_step',{_operation_id:operation.id,_step:'void'});
   await paypal.voidAuthorization(authorization.id,operation.void_request_id);
   authorization=validateDepositOrder(await paypal.getOrder(deposit.provider_order_id!),deposit);
  }
  if (authorization && !['VOIDED','EXPIRED'].includes(authorization.status)) throw new PaymentError(409,'Verified release required before refund.');
  await rpc(db,'record_paypal_cancellation_void',{_operation_id:operation.id,_authorization_id:authorization?.id??null,_status:authorization?.status??'NONE'});
  operation={...operation,state:'voided'};
 }
 if (!operation.provider_refund_id && ['refunding','reconciliation_required'].includes(operation.state)) {
  const refundId=await paypal.findCancellationRefund(payment.capture_id!,payment.order_id!,operation.created_at);
  await reconcileRefund(db,paypal,operation,payment,refundId);
  operation={...operation,provider_refund_id:refundId};
 }
 if (operation.provider_refund_id) {
  const status=await reconcileRefund(db,paypal,operation,payment,operation.provider_refund_id);
  if (status!=='COMPLETED') return {ok:false,state:'reconciliation_required',refundStatus:status,bookingConfirmed:false};
 } else if (Number(operation.refund_amount_cents)>0) {
  if (!dispatch || operation.state!=='voided') throw new PaymentError(409,'Refund outcome needs reconciliation. No retry was sent.');
  const capture=await paypal.getCapture(payment.capture_id!);
  if (capture.id!==payment.capture_id || capture.status!=='COMPLETED' || capture.amount.currency_code!==payment.currency.toUpperCase() || paypalCents(capture.amount.value)!==Number(payment.amount_cents) || capture.supplementary_data?.related_ids?.order_id!==payment.order_id) throw new PaymentError(409,'Original capture is not verified as refundable.');
  await rpc(db,'claim_paypal_cancellation_step',{_operation_id:operation.id,_step:'refund'});
  const refund=await paypal.refundCapture(payment.capture_id!,Number(operation.refund_amount_cents),operation.currency,operation.refund_request_id);
  if(typeof refund.id!=='string' || !refund.id)throw new PaymentError(409,'Refund identity unavailable. Reconcile without retry.');
  // Persist identity immediately; completion still requires an independent GET.
  await rpc(db,'attach_paypal_cancellation_refund',{_operation_id:operation.id,_refund_id:refund.id});
  const status=await reconcileRefund(db,paypal,{...operation,state:'refunding',provider_refund_id:refund.id},payment,refund.id);
  if (status!=='COMPLETED') return {ok:false,state:'reconciliation_required',refundStatus:status,bookingConfirmed:false};
 }
 return rpc(db,'complete_paypal_cancellation',{_operation_id:operation.id});
}
