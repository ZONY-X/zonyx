// Module 1B: unit tests for the pure hold-action decision logic.
// Run: npx tsx supabase/functions/_shared/authorization-hold-actions.test.ts
// No Stripe, no DB, no network — verifies every guard required before money moves.
import assert from "node:assert";
import { parseHoldRequest, planHoldAction, FINAL_HOLD_STATUSES } from "./authorization-hold-actions.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

// ---------- parseHoldRequest ----------
check("parse rejects missing bookingId", () => {
  const r = parseHoldRequest({ action: "release" });
  assert.equal(r.ok, false);
  assert.match(r.error!, /bookingId is required/);
});

check("parse rejects invalid action", () => {
  const r = parseHoldRequest({ bookingId: "b1", action: "refund" });
  assert.equal(r.ok, false);
  assert.match(r.error!, /action must be/);
});

check("parse rejects capture without amount", () => {
  const r = parseHoldRequest({ bookingId: "b1", action: "capture" });
  assert.equal(r.ok, false);
  assert.match(r.error!, /amountCents is required/);
});

check("parse rejects non-integer capture amount", () => {
  const r = parseHoldRequest({ bookingId: "b1", action: "capture", amountCents: 12.5 });
  assert.equal(r.ok, false);
});

check("parse rejects zero capture amount", () => {
  const r = parseHoldRequest({ bookingId: "b1", action: "capture", amountCents: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error!, /greater than zero/);
});

check("parse rejects negative capture amount", () => {
  const r = parseHoldRequest({ bookingId: "b1", action: "capture", amountCents: -500 });
  assert.equal(r.ok, false);
});

check("parse accepts release without amount and trims bookingId", () => {
  const r = parseHoldRequest({ bookingId: " b1 ", action: "release" });
  assert.equal(r.ok, true);
  assert.equal(r.bookingId, "b1");
  assert.equal(r.amountCents, undefined);
});

check("parse accepts whole-number capture amount", () => {
  const r = parseHoldRequest({ bookingId: "b1", action: "capture", amountCents: 500 });
  assert.equal(r.ok, true);
  assert.equal(r.amountCents, 500);
});

// ---------- planHoldAction: release ----------
check("release succeeds for eligible requires_capture authorization", () => {
  const p = planHoldAction({
    action: "release",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "requires_capture",
    stripeCapturableCents: 50000,
  });
  assert.equal(p.ok, true);
  assert.equal(p.stripeAction, "cancel");
  assert.equal(p.persistStatus, "released");
  assert.notEqual(p.alreadyFinalized, true);
});

check("repeated release is safe (DB already released → no Stripe call)", () => {
  const p = planHoldAction({
    action: "release",
    dbHoldStatus: "released",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "canceled",
  });
  assert.equal(p.ok, true);
  assert.equal(p.stripeAction, "none");
  assert.equal(p.alreadyFinalized, true);
  assert.equal(p.persistStatus, "released");
});

check("release converges when Stripe already canceled but DB not finalized", () => {
  const p = planHoldAction({
    action: "release",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "canceled",
  });
  assert.equal(p.ok, true);
  assert.equal(p.stripeAction, "none");
  assert.equal(p.persistStatus, "released");
});

check("release refuses an already-captured (succeeded) PaymentIntent", () => {
  const p = planHoldAction({
    action: "release",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "succeeded",
  });
  assert.equal(p.ok, false);
  assert.equal(p.httpStatus, 409);
  assert.match(p.error!, /already captured/);
  assert.equal(p.stripeAction, "none");
});

check("release fails safely with no stored authorization", () => {
  const p = planHoldAction({ action: "release", dbHoldStatus: null, dbPaymentIntentId: null });
  assert.equal(p.ok, false);
  assert.equal(p.stripeAction, "none");
  assert.equal(p.httpStatus, 409);
});

check("release fails safely on unknown Stripe status", () => {
  const p = planHoldAction({
    action: "release",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "requires_payment_method",
  });
  assert.equal(p.ok, false);
  assert.equal(p.httpStatus, 409);
  assert.equal(p.stripeAction, "none");
});

// ---------- planHoldAction: capture ----------
check("valid partial capture plans a capture for the requested amount", () => {
  const p = planHoldAction({
    action: "capture",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "requires_capture",
    stripeCapturableCents: 50000,
    requestedAmountCents: 1000,
  });
  assert.equal(p.ok, true);
  assert.equal(p.stripeAction, "capture");
  assert.equal(p.stripeAmountCents, 1000);
  assert.equal(p.persistStatus, "captured");
});

check("full capture up to the authorized amount is allowed", () => {
  const p = planHoldAction({
    action: "capture",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "requires_capture",
    stripeCapturableCents: 50000,
    requestedAmountCents: 50000,
  });
  assert.equal(p.ok, true);
  assert.equal(p.stripeAmountCents, 50000);
});

check("capture exceeding the authorized amount is rejected", () => {
  const p = planHoldAction({
    action: "capture",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "requires_capture",
    stripeCapturableCents: 50000,
    requestedAmountCents: 50001,
  });
  assert.equal(p.ok, false);
  assert.equal(p.httpStatus, 400);
  assert.match(p.error!, /exceeds the authorized amount/);
  assert.equal(p.stripeAction, "none");
});

check("repeated capture is prevented once the DB records captured", () => {
  const p = planHoldAction({
    action: "capture",
    dbHoldStatus: "captured",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "succeeded",
    stripeCapturableCents: 0,
    requestedAmountCents: 100,
  });
  assert.equal(p.ok, false);
  assert.equal(p.httpStatus, 409);
  assert.match(p.error!, /already been captured/);
  assert.equal(p.stripeAction, "none");
});

check("capture after release is prevented", () => {
  const p = planHoldAction({
    action: "capture",
    dbHoldStatus: "released",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "canceled",
    stripeCapturableCents: 0,
    requestedAmountCents: 100,
  });
  assert.equal(p.ok, false);
  assert.equal(p.httpStatus, 409);
  assert.match(p.error!, /already been released/);
});

check("capture fails safely when authorization has expired", () => {
  const p = planHoldAction({
    action: "capture",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "requires_capture",
    stripeCapturableCents: 50000,
    requestedAmountCents: 1000,
    captureBeforeMs: 1000,
    nowMs: 2000,
  });
  assert.equal(p.ok, false);
  assert.equal(p.httpStatus, 409);
  assert.match(p.error!, /expired/);
  assert.equal(p.stripeAction, "none");
});

check("capture allowed while still within the capture-before window", () => {
  const p = planHoldAction({
    action: "capture",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "requires_capture",
    stripeCapturableCents: 50000,
    requestedAmountCents: 1000,
    captureBeforeMs: 3000,
    nowMs: 2000,
  });
  assert.equal(p.ok, true);
});

check("capture fails safely when Stripe says the PI is not capturable", () => {
  const p = planHoldAction({
    action: "capture",
    dbHoldStatus: "authorized",
    dbPaymentIntentId: "pi_1",
    stripePaymentIntentStatus: "canceled",
    stripeCapturableCents: 50000,
    requestedAmountCents: 1000,
  });
  assert.equal(p.ok, false);
  assert.equal(p.httpStatus, 409);
  assert.match(p.error!, /not capturable/);
});

check("capture fails safely with no stored authorization", () => {
  const p = planHoldAction({ action: "capture", dbPaymentIntentId: null, requestedAmountCents: 100 });
  assert.equal(p.ok, false);
  assert.equal(p.httpStatus, 409);
});

// ---------- invariants ----------
check("final hold statuses are exactly released and captured", () => {
  assert.deepEqual([...FINAL_HOLD_STATUSES], ["released", "captured"]);
});

console.log(`\nAll ${passed} authorization-hold guard tests passed.`);
