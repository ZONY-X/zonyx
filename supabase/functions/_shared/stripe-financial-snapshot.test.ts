import assert from "node:assert";
import { authorizeInspector, buildFinancialSnapshot, normalizeDeposit, normalizeDepositHistory, parseInspectorInput, stripeRetrievePath } from "./stripe-financial-snapshot.ts";

assert.equal(authorizeInspector(false, false).status, 401);
assert.equal(authorizeInspector(true, false).status, 403);
assert.equal(authorizeInspector(true, false).allowed, false); // same result for Guest and ordinary Host
assert.equal(authorizeInspector(true, true).allowed, true);
console.log("PASS: unauthenticated, Guest, and ordinary Host are rejected; authoritative Admin is accepted");

assert.equal(stripeRetrievePath("payment_intents", "pi_1"), "/payment_intents/pi_1?expand[]=payment_method&expand[]=latest_charge");
assert.equal(stripeRetrievePath("charges", "ch_1"), "/charges/ch_1");
assert.equal(stripeRetrievePath("charges", "ch_1").includes("latest_charge"), false);
console.log("PASS: Charge retrieval has no invalid PaymentIntent-only latest_charge expansion");

assert.equal(parseInspectorInput({ booking_id: "b81b9d87-acfe-4e51-a4f3-b49c09e68ab1" }).ok, true);
assert.equal(parseInspectorInput({ booking_id: "b81b9d87-acfe-4e51-a4f3-b49c09e68ab1", payment_intent_id: "pi_attacker" }).ok, false);
assert.equal(parseInspectorInput({ booking_id: "invalid" }).ok, false);
console.log("PASS: input accepts only a booking UUID and rejects client-supplied Stripe IDs");

const partial = normalizeDeposit({ id: "pi_hold", status: "succeeded", amount: 75000, amount_received: 9312, amount_capturable: 0, currency: "usd" }, { id: "ch_hold", amount_captured: 9312 });
assert.equal(partial?.original_authorization, 75000);
assert.equal(partial?.captured_amount, 9312);
assert.equal(partial?.amount_capturable, 0);
assert.equal(partial?.released_or_uncaptured_amount, 65688);
assert.equal(partial?.settled, true);
console.log("PASS: partial $93.12 capture plus released $656.88 remainder is represented from final Stripe state");

assert.deepEqual(normalizeDeposit({ id: "pi", status: "requires_capture", amount: 75000, amount_received: 0, amount_capturable: 75000 }, null)?.released_or_uncaptured_amount, null);
assert.equal(normalizeDeposit({ id: "pi", status: "succeeded", amount: 75000, amount_received: 75000, amount_capturable: 0 }, { amount_captured: 75000 })?.released_or_uncaptured_amount, 0);
assert.equal(normalizeDeposit({ id: "pi", status: "canceled", amount: 75000, amount_received: 0, amount_capturable: 0 }, null)?.released_or_uncaptured_amount, null);
assert.equal(normalizeDeposit({ id: "pi", status: "canceled", amount: 75000, amount_received: 0, amount_capturable: 0 }, null)?.captured_amount, null);
console.log("PASS: authorized and fully captured current states normalize; canceled state stays unknown without history");

const canceledDeposit = { id: "pi_hold", status: "canceled", amount: 75000, amount_received: 0, amount_capturable: 0 };
const depositCharge = { id: "ch_hold", payment_intent: "pi_hold" };
const history = (options: { balance?: number; refunds?: number[]; events?: Record<string, unknown>[] } = {}) => normalizeDepositHistory({
  paymentIntent: canceledDeposit,
  charge: depositCharge,
  balanceTransactions: options.balance === undefined ? [] : [{ id: "txn_hold", source: "ch_hold", type: "charge", amount: options.balance, fee: 300, net: options.balance - 300, status: "available" }],
  refunds: (options.refunds ?? []).map((amount, index) => ({ id: `re_${index}`, payment_intent: "pi_hold", charge: "ch_hold", amount, status: "succeeded" })),
  events: options.events ?? [],
});

const releasedWithoutCapture = history({ events: [{ id: "evt_release", type: "payment_intent.canceled", data: { object: canceledDeposit, previous_attributes: { amount_capturable: 75000 } } }] });
assert.equal(releasedWithoutCapture.historical_captured_amount, 0);
assert.equal(releasedWithoutCapture.historical_released_uncaptured_amount, 75000);
assert.equal(releasedWithoutCapture.historical_capture_status, "released_without_capture");
console.log("PASS: CASE A — $750 authorization, $0 captured, $750 released requires explicit cancellation-event evidence");

const partialHistory = history({ balance: 9312 });
assert.equal(partialHistory.historical_captured_amount, 9312);
assert.equal(partialHistory.historical_released_uncaptured_amount, 65688);
assert.equal(partialHistory.historical_capture_status, "partial_capture_remainder_released");
console.log("PASS: CASE B/E — final canceled PI plus balance evidence proves $93.12 captured and $656.88 released");

const fullHistory = history({ balance: 75000 });
assert.equal(fullHistory.historical_captured_amount, 75000);
assert.equal(fullHistory.historical_released_uncaptured_amount, 0);
assert.equal(fullHistory.historical_capture_status, "fully_captured");
console.log("PASS: CASE C — full $750 capture is proven by Charge balance transaction");

const refundedHistory = history({ balance: 9312, refunds: [9312] });
assert.equal(refundedHistory.historical_captured_amount, 9312);
assert.equal(refundedHistory.historical_refunded_amount, 9312);
assert.equal(refundedHistory.historical_released_uncaptured_amount, 65688);
console.log("PASS: CASE D — $93.12 captured then refunded remains distinct from released authorization");

const unknownHistory = history();
assert.equal(unknownHistory.historical_captured_amount, null);
assert.equal(unknownHistory.historical_released_uncaptured_amount, null);
assert.equal(unknownHistory.historical_capture_status, "unknown");
console.log("PASS: CASE F — canceled PI with insufficient evidence returns Unknown, never invented $0/$750");

const snapshot = buildFinancialSnapshot({
  booking: { id: "b", reservation_number: "ZNX-1" },
  checkout: { id: "cs", payment_intent: { id: "pi_rental" }, amount_subtotal: 10000, amount_total: 12000, currency: "usd" },
  lineItems: [],
  rentalPaymentIntent: { id: "pi_rental", status: "succeeded", amount: 12000, amount_received: 12000, amount_capturable: 0, currency: "usd", latest_charge: "ch_1" },
  rentalCharge: { id: "ch_1", amount: 12000, amount_captured: 12000, amount_refunded: 3000, payment_method_details: { card: { brand: "visa", last4: "4242" } } },
  refunds: [{ id: "re_1", amount: 1000, status: "succeeded" }, { id: "re_2", amount: 2000, status: "succeeded" }],
  depositPaymentIntent: null, depositCharge: null, observedAt: "2026-01-01T00:00:00Z",
});
assert.equal(snapshot.checkout?.payment_intent_id, "pi_rental");
assert.equal(snapshot.rental_payment?.refunds.length, 2);
assert.deepEqual(snapshot.safe_payment_method, { brand: "visa", last4: "4242" });
console.log("PASS: rental PaymentIntent derives from Checkout, multiple refunds and safe card display normalize correctly");