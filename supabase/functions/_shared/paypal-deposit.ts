import { PaymentError, paypalCents, type PayPalOrder } from "./payment-policy.ts";
import { env, type DB, type Payment, rpc } from "./payment-service.ts";
export type Deposit = {
  id: string; booking_id: string; rental_payment_id: string; amount_cents: number;
  currency: string; status: string; operation_state: string;
  provider_order_id: string | null; provider_authorization_id: string | null;
  create_request_id: string; authorize_request_id: string;
};
type Authorization = {id: string; status: string; amount: {value: string; currency_code: string}; create_time: string; expiration_time: string};
export function validateDepositOrder(order: PayPalOrder, deposit: Deposit) {
  const units = order.purchase_units;
  if (!order.id || (deposit.provider_order_id && order.id !== deposit.provider_order_id) ||
      order.intent !== "AUTHORIZE" || units?.length !== 1 ||
      units[0].custom_id !== deposit.id || units[0].reference_id !== deposit.id ||
      units[0].amount?.currency_code !== deposit.currency.toUpperCase() ||
      paypalCents(units[0].amount?.value) !== Number(deposit.amount_cents) ||
      (units[0].payments?.captures?.length || 0) !== 0) {
    throw new PaymentError(409, "Security deposit authorization evidence conflicts. No deposit capture is permitted.");
  }
  const authorizations = (units[0].payments as {authorizations?: Authorization[]} | undefined)?.authorizations || [];
  if (authorizations.length > 1) throw new PaymentError(409, "Multiple deposit authorizations require reconciliation.");
  const authorization = authorizations[0];
  if (authorization && (!authorization.id || authorization.amount.currency_code !== deposit.currency.toUpperCase() ||
      paypalCents(authorization.amount.value) !== Number(deposit.amount_cents) ||
      (deposit.provider_authorization_id && deposit.provider_authorization_id !== authorization.id))) {
    throw new PaymentError(409, "Deposit amount or authorization identity conflicts.");
  }
  return authorization;
}
export async function persistDepositAuthorization(db: DB, payment: Payment, deposit: Deposit, order: PayPalOrder) {
  const authorization = validateDepositOrder(order, deposit);
  if (!authorization || authorization.status !== "CREATED" || order.status !== "COMPLETED") {
    throw new PaymentError(409, "Deposit authorization is not verified. Check this existing authorization; do not retry blindly.");
  }
  const created = Date.parse(authorization.create_time), expires = Date.parse(authorization.expiration_time);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= Date.now() || created > Date.now()+300000) {
    throw new PaymentError(409, "Valid deposit authorization timestamps required.");
  }
  if (!["sandbox","live"].includes(payment.environment) || payment.state !== "paid") throw new PaymentError(409, "Verified sandbox rental required.");
  const receipt=await rpc<Record<string, unknown>>(db, "record_paypal_sandbox_authorization", {
    _deposit_id: deposit.id, _order_id: order.id, _authorization_id: authorization.id,
    _amount_cents: Number(deposit.amount_cents), _currency: deposit.currency,
    _authorized_at: authorization.create_time, _expires_at: authorization.expiration_time,
  });
  if(receipt.bookingConfirmed===true && payment.environment==="live" && env("PAYPAL_CUSTOMER_NOTIFICATIONS_ENABLED")==="true") {
    try {
      const {data,error}=await db.functions.invoke("send-booking-confirmation",{body:{bookingId:payment.booking_id}});
      receipt.notificationStatus=!error && (data?.sent || data?.skipped)?"sent":"pending";
    } catch { receipt.notificationStatus="pending"; }
  }
  return receipt;
}
