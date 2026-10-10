import { test } from "node:test";
import assert from "node:assert/strict";
import { additionalWallets, loadPayPalSdk } from "./paypal-sdk.ts";
test("Apple and Google wallets remain unavailable until separate onboarding and adapters", () => {
  assert.deepEqual(additionalWallets.map((wallet) => wallet.id), [
    "apple_pay",
    "google_pay",
  ]);
  assert.ok(additionalWallets.every((wallet) => wallet.enabled === false));
});


test("SDK load failure permits retry, shares concurrent loads and locks the loaded environment", async () => {
  const scripts: Array<{ src?: string; onload?: (() => void) | null; onerror?: (() => void) | null; remove: () => void }> = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let removed = 0;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const sdk = { createInstance: async () => ({}) };
  const fakeWindow = {
    paypal: undefined as unknown,
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => { timers.delete(id); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => ({ remove: () => { removed++; } }),
    head: { appendChild: (script: typeof scripts[number]) => scripts.push(script) },
  } });
  try {
    const first = loadPayPalSdk("sandbox");
    assert.equal(loadPayPalSdk("sandbox"), first);
    scripts[0].onerror?.();
    await assert.rejects(first, /unavailable/);
    assert.equal(removed, 1);
    assert.equal(timers.size, 0);
    const timedOut = loadPayPalSdk("sandbox");
    for (const callback of timers.values()) callback();
    await assert.rejects(timedOut, /unavailable/);
    assert.equal(removed, 2);
    const retry = loadPayPalSdk("sandbox");
    fakeWindow.paypal = sdk;
    scripts[2].onload?.();
    assert.equal(await retry, sdk);
    assert.equal(scripts.length, 3);
    assert.equal(timers.size, 0);
    await assert.rejects(loadPayPalSdk("live"), /environment changed/);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
