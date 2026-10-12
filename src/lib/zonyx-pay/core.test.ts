import assert from "node:assert/strict";
import { PaymentOrchestrator, validatePaymentRequest, type PaymentAdapter, type PaymentRequest } from "./core.ts";

const request: PaymentRequest = {
  operationId: "op-1", bookingId: "booking-1", merchantId: "zonyx",
  provider: "fixture", idempotencyKey: "stable-key",
  amount: { currency: "USD", amountMinor: 12500 },
};
const outcome = { operationId: "op-1", provider: "fixture", status: "captured" as const, occurredAt: "2026-10-11T00:00:00Z" };
function adapter(charge: PaymentAdapter["charge"]): PaymentAdapter {
  return { provider: "fixture", charge } as PaymentAdapter;
}
assert.throws(() => validatePaymentRequest({ ...request, amount: { currency: "USD", amountMinor: 0 } }));
assert.throws(() => validatePaymentRequest({ ...request, amount: { currency: "USD", amountMinor: 1.5 } }));
assert.throws(() => validatePaymentRequest({ ...request, idempotencyKey: "" }));
await assert.rejects(new PaymentOrchestrator(new Map()).execute("charge", request), /not configured/);
let calls = 0;
const orchestrator = new PaymentOrchestrator(new Map([["fixture", adapter(async received => {
  calls++;
  assert.deepEqual(received, request);
  return outcome;
})]]));
assert.deepEqual(await orchestrator.execute("charge", request), outcome);
assert.equal(calls, 1);
let unknownCalls = 0;
const unknown = new PaymentOrchestrator(new Map([["fixture", adapter(async () => {
  unknownCalls++;
  return { ...outcome, status: "unknown" };
})]]));
assert.equal((await unknown.execute("charge", request)).status, "unknown");
assert.equal(unknownCalls, 1);
