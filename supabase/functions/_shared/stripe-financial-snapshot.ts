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

export function stripeRetrievePath(family: "payment_intents" | "charges", id: string) {
  const base = `/${family}/${encodeURIComponent(id)}`;
  return family === "payment_intents" ? `${base}?expand[]=payment_method&expand[]=latest_charge` : base;
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

function normalizeBalanceTransaction(transaction: StripeObject | null) {
  if (!transaction) return null;
  return {
    id: stringOrNull(transaction.id), amount: numberOrNull(transaction.amount), fee: numberOrNull(transaction.fee),
    net: numberOrNull(transaction.net), currency: stringOrNull(transaction.currency), type: stringOrNull(transaction.type),
    reporting_category: stringOrNull(transaction.reporting_category), status: stringOrNull(transaction.status),
    created: numberOrNull(transaction.created), available_on: numberOrNull(transaction.available_on), source_id: objectId(transaction.source),
  };
}

export function normalizeDepositHistory(input: {
  paymentIntent: StripeObject | null;
  charge: StripeObject | null;
  refunds: StripeObject[];
  balanceTransactions: StripeObject[];
  events: StripeObject[];
}) {
  const paymentIntentId = objectId(input.paymentIntent?.id);
  const chargeId = objectId(input.charge?.id);
  const original = numberOrNull(input.paymentIntent?.amount);
  const currentStatus = stringOrNull(input.paymentIntent?.status);
  const currentCapturable = numberOrNull(input.paymentIntent?.amount_capturable);
  const evidence: Record<string, unknown>[] = [];
  const captureCandidates: number[] = [];

  for (const transaction of input.balanceTransactions) {
    const sourceId = objectId(transaction.source);
    const amount = numberOrNull(transaction.amount);
    const type = stringOrNull(transaction.type);
    if (chargeId && sourceId === chargeId && amount !== null && amount >= 0 && (type === "charge" || type === "payment")) {
      captureCandidates.push(amount);
      evidence.push({ source_type: "balance_transaction", source_id: objectId(transaction.id), created: numberOrNull(transaction.created), proves: "captured_amount", amount });
    }
  }

  for (const event of input.events) {
    const data = objectOrNull(event.data);
    const object = objectOrNull(data?.object);
    const previous = objectOrNull(data?.previous_attributes);
    if (!object) continue;
    const objectIdValue = objectId(object.id);
    const objectPiId = objectId(object.payment_intent);
    if (objectIdValue !== paymentIntentId && objectIdValue !== chargeId && objectPiId !== paymentIntentId) continue;
    const eventType = stringOrNull(event.type);
    const piReceived = objectIdValue === paymentIntentId ? numberOrNull(object.amount_received) : null;
    const chargeCaptured = objectIdValue === chargeId ? numberOrNull(object.amount_captured) : null;
    const provenCapture = piReceived !== null && piReceived > 0 ? piReceived : chargeCaptured !== null && chargeCaptured > 0 ? chargeCaptured : null;
    if (provenCapture !== null) {
      captureCandidates.push(provenCapture);
      evidence.push({ source_type: "stripe_event", source_id: objectId(event.id), event_type: eventType, created: numberOrNull(event.created), proves: "captured_amount", amount: provenCapture });
    }
    const previousCapturable = numberOrNull(previous?.amount_capturable);
    if (eventType === "payment_intent.canceled" && objectIdValue === paymentIntentId && piReceived === 0 && numberOrNull(object.amount_capturable) === 0 && previousCapturable !== null && previousCapturable > 0) {
      captureCandidates.push(0);
      evidence.push({ source_type: "stripe_event", source_id: objectId(event.id), event_type: eventType, created: numberOrNull(event.created), proves: "released_without_capture", amount: previousCapturable });
    }
  }

  const captured = captureCandidates.length ? Math.max(...captureCandidates) : null;
  const settled = (currentStatus === "succeeded" || currentStatus === "canceled") && currentCapturable === 0;
  const released = settled && original !== null && captured !== null ? Math.max(0, original - captured) : null;
  const successfulRefunds = input.refunds.filter((refund) => stringOrNull(refund.status) === "succeeded");
  const refunded = successfulRefunds.length ? successfulRefunds.reduce((sum, refund) => sum + (numberOrNull(refund.amount) ?? 0), 0) : 0;
  for (const refund of input.refunds) evidence.push({ source_type: "stripe_refund", source_id: objectId(refund.id), created: numberOrNull(refund.created), proves: "refund", amount: numberOrNull(refund.amount), status: stringOrNull(refund.status) });
  const historicalStatus = captured === null ? "unknown" : captured === 0 && released === original ? "released_without_capture" : original !== null && captured === original ? "fully_captured" : released !== null && released > 0 ? "partial_capture_remainder_released" : "captured";
  return {
    historical_capture_status: historicalStatus,
    historical_captured_amount: captured,
    historical_released_uncaptured_amount: released,
    historical_refunded_amount: refunded,
    evidence,
    balance_transactions: input.balanceTransactions.map(normalizeBalanceTransaction),
    event_history_available: input.events.length > 0,
  };
}

export type DepositAssociationConfidence = "CONFIRMED" | "PROBABLE" | "AMBIGUOUS" | "REJECTED";

export function classifyDepositAttempt(input: {
  paymentIntent: StripeObject;
  bookingId: string;
  storedDepositPaymentIntentId?: string | null;
  rentalPaymentIntentId?: string | null;
  stripeCustomerId?: string | null;
  expectedAuthorizationAmount?: number | null;
  windowStart?: number | null;
  windowEnd?: number | null;
}) {
  const pi = input.paymentIntent;
  const id = objectId(pi.id);
  const metadata = objectOrNull(pi.metadata);
  const metadataBooking = stringOrNull(metadata?.bookingId);
  const purpose = stringOrNull(metadata?.purpose);
  const customer = objectId(pi.customer);
  const created = numberOrNull(pi.created);
  const amount = numberOrNull(pi.amount);
  const manual = stringOrNull(pi.capture_method) === "manual";
  const inWindow = created !== null && (input.windowStart === null || input.windowStart === undefined || created >= input.windowStart) && (input.windowEnd === null || input.windowEnd === undefined || created <= input.windowEnd);
  const sameCustomer = !!input.stripeCustomerId && customer === input.stripeCustomerId;
  const expectedAmount = typeof input.expectedAuthorizationAmount === "number" && amount === input.expectedAuthorizationAmount;

  if (id && id === input.rentalPaymentIntentId) return { confidence: "REJECTED" as const, reasons: ["rental_payment_intent"] };
  if (metadataBooking && metadataBooking !== input.bookingId) return { confidence: "REJECTED" as const, reasons: ["different_booking_metadata"] };
  if (id && id === input.storedDepositPaymentIntentId) return { confidence: "CONFIRMED" as const, reasons: ["stored_booking_deposit_reference"] };
  if (metadataBooking === input.bookingId && purpose === "authorization_hold") return { confidence: "CONFIRMED" as const, reasons: ["booking_id_metadata", "authorization_hold_purpose"] };
  if (metadataBooking === input.bookingId && manual) return { confidence: "CONFIRMED" as const, reasons: ["booking_id_metadata", "manual_capture"] };
  if (purpose === "authorization_hold" && sameCustomer && inWindow) return { confidence: "PROBABLE" as const, reasons: ["authorization_hold_purpose", "same_customer", "booking_time_window"] };
  if (manual && sameCustomer && expectedAmount && inWindow) return { confidence: "AMBIGUOUS" as const, reasons: ["same_customer", "same_amount", "manual_capture", "booking_time_window"] };
  return { confidence: "REJECTED" as const, reasons: ["insufficient_or_contradictory_booking_evidence"] };
}

export function normalizeDepositAttempt(input: {
  paymentIntent: StripeObject;
  charge: StripeObject | null;
  refunds: StripeObject[];
  balanceTransactions: StripeObject[];
  events: StripeObject[];
  association: { confidence: DepositAssociationConfidence; reasons: string[] };
}) {
  const current = normalizeDeposit(input.paymentIntent, input.charge);
  const history = normalizeDepositHistory({ paymentIntent: input.paymentIntent, charge: input.charge, refunds: input.refunds, balanceTransactions: input.balanceTransactions, events: input.events });
  const canceledEvent = input.events.find((event) => stringOrNull(event.type) === "payment_intent.canceled" && objectId(objectOrNull(objectOrNull(event.data)?.object)?.id) === objectId(input.paymentIntent.id));
  const request = objectOrNull(canceledEvent?.request);
  const cancellationOrigin = !canceledEvent ? "unknown" : objectId(request?.id) ? "api_request" : "stripe_automatic_or_expiry";
  return {
    payment_intent_id: objectId(input.paymentIntent.id),
    created: numberOrNull(input.paymentIntent.created),
    original_authorization: numberOrNull(input.paymentIntent.amount),
    currency: stringOrNull(input.paymentIntent.currency),
    customer_id: objectId(input.paymentIntent.customer),
    current_status: stringOrNull(input.paymentIntent.status),
    current_capturable: numberOrNull(input.paymentIntent.amount_capturable),
    cancellation_timestamp: numberOrNull(input.paymentIntent.canceled_at),
    cancellation_reason: stringOrNull(input.paymentIntent.cancellation_reason),
    cancellation_origin: cancellationOrigin,
    charge_id: objectId(input.charge?.id),
    settled: current?.settled ?? false,
    association: input.association,
    history,
  };
}

export function summarizeDepositAttempts(attempts: ReturnType<typeof normalizeDepositAttempt>[]) {
  const confirmed = attempts
    .filter((attempt) => attempt.association.confidence === "CONFIRMED")
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  const captureKnown = confirmed.every((attempt) => attempt.history.historical_captured_amount !== null);
  const captured = captureKnown ? confirmed.reduce((sum, attempt) => sum + (attempt.history.historical_captured_amount ?? 0), 0) : null;
  const refunded = confirmed.reduce((sum, attempt) => sum + attempt.history.historical_refunded_amount, 0);
  return {
    total_candidates_discovered: attempts.length,
    confirmed_attempts: confirmed.length,
    probable_attempts: attempts.filter((attempt) => attempt.association.confidence === "PROBABLE").length,
    ambiguous_attempts: attempts.filter((attempt) => attempt.association.confidence === "AMBIGUOUS").length,
    rejected_candidates: attempts.filter((attempt) => attempt.association.confidence === "REJECTED").length,
    total_actually_captured: captured,
    total_refunded: refunded,
    net_deposit_retained: captured === null ? null : captured - refunded,
    final_confirmed_outcome: confirmed.length ? confirmed[confirmed.length - 1].history.historical_capture_status : "unknown",
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
  const captured = status === "canceled" && (capturedFromCharge === null || capturedFromCharge === 0)
    ? null
    : capturedFromCharge !== null ? capturedFromCharge : received;
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
  depositRefunds?: StripeObject[];
  depositBalanceTransactions?: StripeObject[];
  depositEvents?: StripeObject[];
  depositAttempts?: ReturnType<typeof normalizeDepositAttempt>[];
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
    security_deposit: input.depositPaymentIntent ? {
      ...normalizeDeposit(input.depositPaymentIntent, input.depositCharge),
      history: normalizeDepositHistory({ paymentIntent: input.depositPaymentIntent, charge: input.depositCharge, refunds: input.depositRefunds ?? [], balanceTransactions: input.depositBalanceTransactions ?? [], events: input.depositEvents ?? [] }),
    } : null,
    security_deposit_attempts: {
      summary: summarizeDepositAttempts(input.depositAttempts ?? []),
      timeline: [...(input.depositAttempts ?? [])].sort((a, b) => (a.created ?? 0) - (b.created ?? 0)),
    },
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