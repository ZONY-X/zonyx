import { test } from "node:test";
import assert from "node:assert/strict";
import { additionalWallets } from "./paypal-sdk.ts";
test("Apple and Google wallets remain unavailable until separate onboarding and adapters", () => {
  assert.deepEqual(additionalWallets.map((wallet) => wallet.id), [
    "apple_pay",
    "google_pay",
  ]);
  assert.ok(additionalWallets.every((wallet) => wallet.enabled === false));
});
