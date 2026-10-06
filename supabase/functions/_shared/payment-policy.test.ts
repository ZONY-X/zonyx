import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalUrl,
  assertAmountIntegrity,
  assertInternalCheckout,
  paypalCents,
  paypalEnvironment,
  type PayPalOrder,
  planSecurityDeposit,
  validatePayPalOrder,
} from "./payment-policy.ts";
const booking = {
  subtotal_cents: 10000,
  service_fee_cents: 1200,
  taxes_cents: 896,
  grand_total_cents: 12096,
  currency: "usd",
};
const summary = {
  subtotal_cents: 10000,
  service_fee_cents: 1200,
  taxes_cents: 896,
  final_total_cents: 12096,
  currency: "usd",
};
const payment = {
  id: "fixture-payment",
  order_id: "fixture-order",
  amount_cents: 12096,
  currency: "usd",
};
const order = (): PayPalOrder => ({
  id: "fixture-order",
  intent: "CAPTURE",
  status: "APPROVED",
  purchase_units: [{
    reference_id: payment.id,
    custom_id: payment.id,
    amount: { value: "120.96", currency_code: "USD" },
  }],
});
test("accepted server amounts must exactly match persisted booking components", () => {
  assert.equal(assertAmountIntegrity(booking, summary), 12096);
  for (
    const field of [
      "subtotal_cents",
      "service_fee_cents",
      "taxes_cents",
      "grand_total_cents",
    ]
  ) {
    assert.throws(() =>
      assertAmountIntegrity({ ...booking, [field]: 1 }, summary)
    );
  }
  for (
    const value of [
      NaN,
      Infinity,
      1.2,
      -1,
      "12096",
      Number.MAX_SAFE_INTEGER + 1,
    ]
  ) {
    assert.throws(() =>
      assertAmountIntegrity({ ...booking, grand_total_cents: value }, summary)
    );
  }
  assert.throws(() =>
    assertAmountIntegrity({ ...booking, currency: "eur" }, summary)
  );
});
test("PayPal decimal parsing is exact and rejects malformed money", () => {
  assert.equal(paypalCents("120.96"), 12096);
  for (const value of ["1", "1.001", "-1.00", "1e2", 100, undefined]) {
    assert.throws(() => paypalCents(value));
  }
});
test("order and capture identities, intent, currency, and amount are isolated", () => {
  assert.equal(validatePayPalOrder(order(), payment), undefined);
  for (
    const changed of [{ ...order(), id: "other" }, {
      ...order(),
      intent: "AUTHORIZE",
    }, { ...order(), purchase_units: [] }]
  ) assert.throws(() => validatePayPalOrder(changed, payment));
  const wrong = order();
  wrong.purchase_units![0].amount!.value = "1.00";
  assert.throws(() => validatePayPalOrder(wrong, payment));
  const captured = order();
  captured.status = "COMPLETED";
  captured.purchase_units![0].payments = {
    captures: [{
      id: "fixture-capture",
      status: "COMPLETED",
      amount: { value: "120.96", currency_code: "USD" },
    }],
  };
  assert.equal(validatePayPalOrder(captured, payment)?.id, "fixture-capture");
  captured.purchase_units![0].payments!.captures!.push(
    captured.purchase_units![0].payments!.captures![0],
  );
  assert.throws(() => validatePayPalOrder(captured, payment));
});
test("internal and live checkout gates fail closed", () => {
  assert.throws(() => assertInternalCheckout(undefined, true, true));
  assert.throws(() => assertInternalCheckout("true", false, true));
  assert.throws(() => assertInternalCheckout("true", true, false));
  assertInternalCheckout("true", true, true);
  assert.equal(paypalEnvironment(() => undefined), "sandbox");
  assert.throws(() =>
    paypalEnvironment((name) =>
      name === "PAYPAL_ENVIRONMENT" ? "live" : undefined
    )
  );
});
test("deposit authorization is disabled even with accidental feature activation", () => {
  assert.equal(planSecurityDeposit(undefined).status, "disabled");
  assert.equal(planSecurityDeposit("true").canAuthorize, false);
  assert.equal(
    planSecurityDeposit("true").status,
    "capability_verification_required",
  );
});
test("approval redirects only target the selected PayPal environment", () => {
  const value = order();
  value.links = [{
    rel: "payer-action",
    href: "https://www.sandbox.paypal.com/checkoutnow?token=fixture-order",
  }];
  assert.match(
    approvalUrl(value, "sandbox"),
    /^https:\/\/www.sandbox.paypal.com/,
  );
  assert.throws(() => approvalUrl(value, "live"));
  value.links[0].href = "https://www.paypal.com.evil.invalid/";
  assert.throws(() => approvalUrl(value, "live"));
});

test("embedded card capture requires canonical server 3DS evidence", async () => {
  const { assertCardCaptureEligible } = await import("./payment-policy.ts");
  const order = { id: "fixture", intent: "CAPTURE", status: "APPROVED" };
  const card = (shift: string | undefined, status?: string) => ({
    ...order,
    payment_source: {
      card: {
        authentication_result: {
          liability_shift: shift,
          three_d_secure: { authentication_status: status },
        },
      },
    },
  });
  assert.throws(() => assertCardCaptureEligible(order), /authentication/);
  for (const shift of ["NO", "UNKNOWN", undefined]) {
    assert.throws(
      () => assertCardCaptureEligible(card(shift)),
      /authentication/,
    );
  }
  for (const status of ["N", "R", "U", "C", "D", ""]) {
    assert.throws(
      () => assertCardCaptureEligible(card("POSSIBLE", status)),
      /authentication/,
    );
  }
  assert.doesNotThrow(() => assertCardCaptureEligible(card("POSSIBLE", "Y")));
  for (const enrollment of ["N", "U", "B", ""]) {
    const value = card("POSSIBLE", "Y");
    Object.assign(value.payment_source.card.authentication_result.three_d_secure, { enrollment_status: enrollment });
    assert.throws(() => assertCardCaptureEligible(value), /authentication/);
  }
});
