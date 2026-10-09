import { test } from "node:test";
import assert from "node:assert/strict";
import { PayPalClient } from "./paypal-client.ts";
import { validatePayPalOrder, assertCardCaptureEligible } from "./payment-policy.ts";
const env = (key: string) =>
  ({
    PAYPAL_ENVIRONMENT: "sandbox",
    PAYPAL_SANDBOX_CLIENT_ID: "synthetic-test-id",
    PAYPAL_SANDBOX_CLIENT_SECRET: "synthetic-test-secret",
  } as Record<string, string>)[key];
test("projected authentication cannot replace canonical financial evidence", async () => {
  const calls: string[] = [];
  const order = { id: "fixture-order", intent: "CAPTURE", status: "APPROVED", purchase_units: [{ reference_id: "fixture-payment", custom_id: "fixture-payment", amount: { value: "1.08", currency_code: "USD" } }] };
  const authentication = { liability_shift: "POSSIBLE", three_d_secure: { enrollment_status: "Y", authentication_status: "Y" } };
  const client = new PayPalClient(env, (async url => {
    calls.push(String(url));
    return new Response(JSON.stringify(String(url).endsWith("/token") ? { access_token: "synthetic-token" } : String(url).includes("?fields=") ? { id: order.id, payment_source: { card: { authentication_result: authentication } } } : order));
  }) as typeof fetch);
  const actual = await client.getOrder(order.id);
  assert.equal(actual.status, "APPROVED");
  assert.equal(validatePayPalOrder(actual, { id: "fixture-payment", order_id: order.id, amount_cents: 108, currency: "usd" }), undefined);
  assert.doesNotThrow(() => assertCardCaptureEligible(actual));
  assert.equal(calls.length, 3);
});
test("authentication for a different order cannot be joined", async () => {
  const client = new PayPalClient(env, (async url => new Response(JSON.stringify(String(url).endsWith("/token") ? { access_token: "synthetic-token" } : { id: String(url).includes("?fields=") ? "different-order" : "fixture-order" }))) as typeof fetch);
  await assert.rejects(client.getOrder("fixture-order"), /identity mismatch/);
});
test("mock-only CAPTURE transport uses stable request ids and caches OAuth per operation", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mock = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify(
        String(url).endsWith("/token")
          ? { access_token: "synthetic-test-token" }
          : { id: "fixture-order" },
      ),
      { status: 200 },
    );
  }) as typeof fetch;
  const client = new PayPalClient(env, mock);
  await client.createOrder({ intent: "CAPTURE" }, "fixture-create-key");
  await client.captureOrder("fixture-order", "fixture-capture-key");
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every((call) =>
      call.url.startsWith("https://api-m.sandbox.paypal.com/")
    ),
  );
  assert.equal(
    (calls[1].init?.headers as Record<string, string>)["PayPal-Request-Id"],
    "fixture-create-key",
  );
  assert.equal(
    (calls[2].init?.headers as Record<string, string>)["PayPal-Request-Id"],
    "fixture-capture-key",
  );
  assert.ok(calls.every((call) => !call.url.endsWith("/authorize")));
});
test("live is refused before any mock transport call unless explicitly enabled", () => {
  let called = false;
  assert.throws(() =>
    new PayPalClient(
      (name) => name === "PAYPAL_ENVIRONMENT" ? "live" : undefined,
      (async () => {
        called = true;
        return new Response();
      }) as typeof fetch,
    )
  );
  assert.equal(called, false);
});
test("live credentials cannot silently authenticate sandbox", async () => {
  let called = false;
  const client = new PayPalClient(
    (key) =>
      key.startsWith("PAYPAL_CLIENT_") ? "synthetic-live-fixture" : undefined,
    (async () => {
      called = true;
      return new Response();
    }) as typeof fetch,
  );
  await assert.rejects(client.getOrder("fixture"), /not configured/);
  assert.equal(called, false);
});
test("provider errors are sanitized and do not expose response/token contents", async () => {
  const client = new PayPalClient(
    env,
    (async (url) =>
      new Response(
        String(url).endsWith("/token")
          ? JSON.stringify({ access_token: "synthetic-test-token" })
          : "sensitive-provider-body-fixture",
        { status: String(url).endsWith("/token") ? 200 : 500 },
      )) as typeof fetch,
  );
  await assert.rejects(
    client.getOrder("fixture"),
    (error) =>
      error instanceof Error &&
      !/sensitive-provider-body-fixture|synthetic-test-token/.test(
        error.message,
      ),
  );
});
test("webhooks require SUCCESS postback and required signature headers", async () => {
  const mock = (async (url) =>
    new Response(
      JSON.stringify(
        String(url).endsWith("/token")
          ? { access_token: "synthetic-test-token" }
          : { verification_status: "SUCCESS" },
      ),
    )) as typeof fetch;
  const client = new PayPalClient(env, mock);
  const headers = new Headers({
    "paypal-cert-url":
      "https://api-m.sandbox.paypal.com/v1/notifications/certs/fixture",
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-transmission-id": "fixture",
    "paypal-transmission-sig": "fixture",
    "paypal-transmission-time": "2026-01-01T00:00:00Z",
  });
  assert.equal(
    await client.verifyWebhook(
      headers,
      { id: "fixture-event" },
      "fixture-webhook",
    ),
    true,
  );
  headers.delete("paypal-transmission-sig");
  assert.equal(
    await client.verifyWebhook(headers, {}, "fixture-webhook"),
    false,
  );
  headers.set("paypal-cert-url", "https://evil.invalid/cert");
  assert.equal(
    await client.verifyWebhook(headers, {}, "fixture-webhook"),
    false,
  );
});
test("browser-safe SDK token uses separate OAuth request and never the cached REST token", async () => {
  const requests: RequestInit[] = [];
  const client = new PayPalClient(
    env,
    (async (_url, init) => {
      requests.push(init!);
      return new Response(
        JSON.stringify({
          id: "fixture-order",
          access_token: String(init?.body).includes("sdk_init")
            ? "synthetic-browser-token"
            : "synthetic-private-token",
        }),
      );
    }) as typeof fetch,
  );
  assert.equal(await client.browserClientToken(), "synthetic-browser-token");
  await client.getOrder("fixture-order");
  assert.equal(
    requests[0].body,
    "grant_type=client_credentials&response_type=client_token&intent=sdk_init",
  );
  assert.equal(requests[1].body, "grant_type=client_credentials");
  assert.equal(
    (requests[2].headers as Record<string, string>).Authorization,
    "Bearer synthetic-private-token",
  );
});
test("failed SDK token response is sanitized", async () => {
  const client = new PayPalClient(
    env,
    (async () =>
      new Response("sensitive-fixture", { status: 403 })) as typeof fetch,
  );
  await assert.rejects(
    client.browserClientToken(),
    /Card initialization is unavailable/,
  );
});

test("unknown create/capture outcomes never automatically retry provider POSTs", async () => {
  for (const operation of ["create", "capture"] as const) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new PayPalClient(env, (async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/token")) {
        return new Response(JSON.stringify({ access_token: "synthetic-token" }));
      }
      throw new Error("synthetic ambiguous transport failure");
    }) as typeof fetch);
    await assert.rejects(operation === "create"
      ? client.createOrder({}, "durable-create-key")
      : client.captureOrder("synthetic-order", "durable-capture-key"), /outcome is unknown; reconciliation/);
    assert.equal(calls.length, 2);
    assert.equal((calls[1].init?.headers as Record<string, string>)["PayPal-Request-Id"],
      operation === "create" ? "durable-create-key" : "durable-capture-key");
    assert.ok(calls.every((call) => call.url.startsWith("https://api-m.sandbox.paypal.com/")));
  }
});
