import { readyEnvironment } from "../../../scripts/payment-runtime-fixture.ts";
import assert from "node:assert/strict";
import { resolvePaymentProvider, activePaymentProvider } from "./payment-adapters/registry.ts";
import { authorizeNetAdapter } from "./payment-adapters/authorize-net.ts";
import { assertRentalProvider } from "./payment-routing.ts";
import { ensureRenewalPaymentLink } from "./renewal-routing.ts";
import type { DB } from "./payment-service.ts";
const env = (provider?: string) => (key: string) => key === "ACTIVE_PAYMENT_PROVIDER" ? provider : readyEnvironment(key);
assert.equal(activePaymentProvider("square"), "square");
for (const invalid of [undefined, "", " ", "SQUARE", "broken", "__proto__"]) {
  assert.throws(() => activePaymentProvider(invalid), /active processor/);
  for (const flow of ["rental", "renewal"] as const) {
    assert.throws(() => resolvePaymentProvider(invalid, null, flow), /No payment was started/);
    for (const original of ["square", "paypal"]) {
      assert.equal(resolvePaymentProvider(invalid, original, flow), original);
    }
  }
}
assert.equal(resolvePaymentProvider("paypal"), "paypal");
assert.equal(resolvePaymentProvider("paypal", "square"), "square");
assert.equal(resolvePaymentProvider("authorize_net", "paypal"), "paypal");
assert.equal(resolvePaymentProvider("broken", "square"), "square");
assert.throws(() => resolvePaymentProvider("authorize_net"), /awaiting activation/);
assert.throws(() => resolvePaymentProvider("broken"), /configuration/);
assert.throws(() => resolvePaymentProvider(""), /configuration/);
assert.throws(() => resolvePaymentProvider("paypal", null, "renewal"), /awaiting activation/);
await assert.rejects(authorizeNetAdapter.checkout(), /awaiting activation/);
let claims = 0;
function database(records: Record<string, unknown> = {}, failed = false, active = "paypal") {
  return { from(table: string) { const query = { select: () => query, eq: () => query, limit: () => query, maybeSingle: async () => ({ data: records[table] || (table === "payment_runtime_config" ? {active_provider:active,version:0} : null), error: failed ? Error("offline") : null }) }; return query; }, rpc: async () => { claims++; return { data: "new-link", error: null }; } } as unknown as DB;
}
await assert.rejects(assertRentalProvider(database(), env("paypal"), "square", "booking"), /Reload/);
await assert.rejects(assertRentalProvider(database({}, true), env("square"), "square", "booking"), /lookup unavailable/);
await assertRentalProvider(database({ booking_payments: { provider: "square" } }), env("paypal"), "square", "booking");
await assert.rejects(assertRentalProvider(database({ booking_payments: { provider: "square" } }), env("paypal"), "paypal", "booking"), /Reload/);
await assert.rejects(ensureRenewalPaymentLink(database(), env("paypal"), "period"), /awaiting activation/);
for (const invalid of [undefined, "", "bad"]) {
  await assert.rejects(assertRentalProvider(database({}, false, invalid || ""), env(invalid), "square", "booking"), /configuration|not ready/);
  await assert.rejects(ensureRenewalPaymentLink(database({}, false, invalid || ""), env(invalid), "period"), /configuration|not ready/);
}
assert.equal(claims, 0);
assert.equal(await ensureRenewalPaymentLink(database({ square_renewal_payment_links: { token: "original-link", enabled: true } }), env("paypal"), "period"), "original-link");
assert.equal(claims, 0);
await assert.rejects(ensureRenewalPaymentLink(database({ square_renewal_payment_links: { token: "disabled", enabled: false } }), env("square"), "period"), /unavailable/);
for (const table of ["renewal_checkout_attempts", "rental_renewal_payment_attempts"]) {
  await assert.rejects(ensureRenewalPaymentLink(database({ [table]: { id: "legacy" }, square_renewal_payment_links: { token: "conflict", enabled: true } }), env("square"), "period"), /existing renewal/);
}
assert.equal(await ensureRenewalPaymentLink(database({ square_renewal_payment_attempts: { id: "original-attempt" } }), env("paypal"), "period"), "new-link");
assert.equal(await ensureRenewalPaymentLink(database({}, false, "square"), env("square"), "period"), "new-link");
assert.equal(claims, 2);
console.log("PASS: active selection, no fallback, historical affinity, lookup failures, disabled Authorize.Net, renewal links and legacy conflicts.");
