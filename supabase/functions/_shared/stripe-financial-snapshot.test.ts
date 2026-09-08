import assert from "node:assert";
import { authorizeInspector, buildFinancialSnapshot, normalizeDeposit, parseInspectorInput } from "./stripe-financial-snapshot.ts";

assert.equal(authorizeInspector(false, false).status, 401);
assert.equal(authorizeInspector(true, false).status, 403);
assert.equal(authorizeInspector(true, false).allowed, false); // same result for Guest and ordinary Host
assert.equal(authorizeInspector(true, true).allowed, true);
console.log("PASS: unauthenticated, Guest, and ordinary Host are rejected; authoritative Admin is accepted");

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
assert.equal(normalizeDeposit({ id: "pi", status: "canceled", amount: 75000, amount_received: 0, amount_capturable: 0 }, null)?.released_or_uncaptured_amount, 75000);
console.log("PASS: authorized, fully captured, and canceled deposit states normalize without inference");

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