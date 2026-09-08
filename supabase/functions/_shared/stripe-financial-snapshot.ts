export interface StripeObject {
  [key: string]: unknown;
}

const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const stringOrNull = (value: unknown) => typeof value === "string" && value ? value : null;
const objectOrNull = (value: unknown): StripeObject | null => typeof value === "object" && value !== null ? value as StripeObject : null;
const objectId = (value: unknown) => stringOrNull(value) ?? stringOrNull(objectOrNull(value)?.id);
const moneyOrNull = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

export function authorizeInspector(authenticated: boolean, authoritativeAdmin: boolean) {
  if (!authenticated) return { allowed: false, status: 401, error: "Authentication required." };
  if (!authoritativeAdmin) return { allowed: false, status: 403, error: "Authoritative Admin access required." };
  return { allowed: true, status: 200, error: null };
}

function safeMetadata(value: unknown) {
  const metadata = objectOrNull(value);
  if (!metadata) return {};
  const allowed = ["bookingId", "vehicleId", "vehicleType", "booking_type", "promo_code", "promo_discount_cents", "addon_total_cents", "purpose", "rentalDays"];
  return Object.fromEntries(allowed.flatMap((key) => typeof metadata[key] === "string" ? [[key, metadata[key]]] : []));
}

function normalizeRefund(refund: StripeObject) {
  return {
    id: stringOrNull(refund.id),
    amount: numberOrNull(refund.amount),
    currency: stringOrNull(refund.currency),
    status: stringOrNull(refund.status),
    created: numberOrNull(refund.created),
    reason: stringOrNull(refund.reason),
    payment_intent_id: objectId(refund.payment_intent),
    charge_id: objectId(refund.charge),
    metadata: safeMetadata(refund.metadata),
  };
}

function cardFrom(paymentIntent: StripeObject | null, charge: StripeObject | null) {
  const paymentMethod = objectOrNull(paymentIntent?.payment_method);
  const paymentMethodCard = objectOrNull(paymentMethod?.card);
  const details = objectOrNull(charge?.payment_method_details);
  const chargeCard = objectOrNull(details?.card);
  const card = paymentMethodCard ?? chargeCard;
  return card ? { brand: stringOrNull(card.brand), last4: stringOrNull(card.last4) } : { brand: null, last4: null };
}

function normalizeCharge(charge: StripeObject | null) {
  if (!charge) return null;
  return {
    id: stringOrNull(charge.id),
    amount: numberOrNull(charge.amount),
    amount_captured: numberOrNull(charge.amount_captured),
    amount_refunded: numberOrNull(charge.amount_refunded),
    captured: typeof charge.captured === "boolean" ? charge.captured : null,
    refunded: typeof charge.refunded === "boolean" ? charge.refunded : null,
    status: stringOrNull(charge.status),
    created: numberOrNull(charge.created),
    receipt_url: stringOrNull(charge.receipt_url),
    metadata: safeMetadata(charge.metadata),
  };
}

function normalizePaymentIntent(paymentIntent: StripeObject | null, charge: StripeObject | null, refunds: StripeObject[]) {
  if (!paymentIntent) return null;
  return {
    payment_intent_id: stringOrNull(paymentIntent.id),
    status: stringOrNull(paymentIntent.status),
    amount: numberOrNull(paymentIntent.amount),
    amount_received: numberOrNull(paymentIntent.amount_received),
    amount_capturable: numberOrNull(paymentIntent.amount_capturable),
    currency: stringOrNull(paymentIntent.currency),
    created: numberOrNull(paymentIntent.created),
    latest_charge: normalizeCharge(charge),
    refunds: refunds.map(normalizeRefund),
    metadata: safeMetadata(paymentIntent.metadata),
  };
}

export function normalizeDeposit(paymentIntent: StripeObject | null, charge: StripeObject | null) {
  if (!paymentIntent) return null;
  const original = numberOrNull(paymentIntent.amount);
  const received = numberOrNull(paymentIntent.amount_received);
  const capturable = numberOrNull(paymentIntent.amount_capturable);
  const status = stringOrNull(paymentIntent.status);
  const capturedFromCharge = numberOrNull(charge?.amount_captured);
  const captured = received ?? capturedFromCharge;
  const isFinal = status === "succeeded" || status === "canceled";
  const released = isFinal && original !== null && captured !== null && capturable !== null
    ? Math.max(0, original - captured - capturable)
    : null;
  const settled = isFinal && capturable === 0;
  return {
    payment_intent_id: stringOrNull(paymentIntent.id),
    stripe_status: status,
    original_authorization: original,
    amount_received: received,
    captured_amount: captured,
    amount_capturable: capturable,
    released_or_uncaptured_amount: released,
    settled,
    canceled_at: numberOrNull(paymentIntent.canceled_at),
    cancellation_reason: stringOrNull(paymentIntent.cancellation_reason),
    created: numberOrNull(paymentIntent.created),
    latest_charge: normalizeCharge(charge),
    metadata: safeMetadata(paymentIntent.metadata),
  };
}

export function buildFinancialSnapshot(input: {
  booking: { id: string; reservation_number: string };
  checkout: StripeObject | null;
  lineItems: StripeObject[];
  rentalPaymentIntent: StripeObject | null;
  rentalCharge: StripeObject | null;
  refunds: StripeObject[];
  depositPaymentIntent: StripeObject | null;
  depositCharge: StripeObject | null;
  observedAt: string;
}) {
  const checkout = input.checkout;
  const totalDetails = objectOrNull(checkout?.total_details);
  const discount = objectOrNull(totalDetails?.breakdown);
  const discounts = Array.isArray(discount?.discounts) ? discount.discounts : [];
  return {
    booking: { booking_id: input.booking.id, reservation_code: input.booking.reservation_number },
    checkout: checkout ? {
      id: stringOrNull(checkout.id),
      status: stringOrNull(checkout.status),
      payment_status: stringOrNull(checkout.payment_status),
      amount_subtotal: numberOrNull(checkout.amount_subtotal),
      amount_total: numberOrNull(checkout.amount_total),
      currency: stringOrNull(checkout.currency),
      payment_intent_id: objectId(checkout.payment_intent),
      customer_id: objectId(checkout.customer),
      created: numberOrNull(checkout.created),
      total_details: totalDetails,
      discounts,
      line_items: input.lineItems.map((line) => ({
        id: stringOrNull(line.id), description: stringOrNull(line.description), quantity: numberOrNull(line.quantity),
        unit_amount: moneyOrNull(objectOrNull(line.price)?.unit_amount_decimal ?? objectOrNull(line.price)?.unit_amount),
        amount_total: numberOrNull(line.amount_total), currency: stringOrNull(line.currency),
      })),
      metadata: safeMetadata(checkout.metadata),
    } : null,
    rental_payment: normalizePaymentIntent(input.rentalPaymentIntent, input.rentalCharge, input.refunds),
    security_deposit: normalizeDeposit(input.depositPaymentIntent, input.depositCharge),
    safe_payment_method: cardFrom(input.rentalPaymentIntent, input.rentalCharge),
    observed_at: input.observedAt,
  };
}

export function parseInspectorInput(body: unknown) {
  const value = body as Record<string, unknown> | null;
  const keys = value && typeof value === "object" ? Object.keys(value) : [];
  if (keys.some((key) => key !== "booking_id")) return { ok: false as const, error: "Only booking_id is accepted." };
  const bookingId = typeof value?.booking_id === "string" ? value.booking_id.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId)) {
    return { ok: false as const, error: "A valid booking_id UUID is required." };
  }
  return { ok: true as const, bookingId };
}