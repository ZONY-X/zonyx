import { expect, test } from "@playwright/test";
for (
  const scenario of [
    "paid",
    "cancelled",
    "failure",
    "pending",
    "missing-reference",
    "ordinary-user",
  ] as const
) {
  test(`PayPal return: ${scenario} never falsely confirms a trip`, async ({ page }) => {
    const calls: string[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (["127.0.0.1", "localhost"].includes(url.hostname)) {
        return route.continue();
      }
      return route.abort();
    });
    const user = {
      id: "11111111-1111-4111-8111-111111111111",
      email: "fixture@example.invalid",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
    };
    await page.addInitScript((user) => {
      const encode = (value: unknown) =>
        btoa(JSON.stringify(value)).replaceAll("=", "").replaceAll("+", "-")
          .replaceAll("/", "_");
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const token = `${encode({ alg: "HS256", typ: "JWT" })}.${
        encode({ sub: user.id, exp: expiry, role: "authenticated" })
      }.fixture-signature`;
      localStorage.setItem(
        "sb-fazzuetfwwfiqehpnjky-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "fixture-refresh",
          expires_in: 3600,
          expires_at: expiry,
          token_type: "bearer",
          user,
        }),
      );
    }, user);
    await page.route("**fazzuetfwwfiqehpnjky.supabase.co/**", async (route) => {
      const url = new URL(route.request().url());
      let body: unknown = [];
      let status = 200;
      if (url.pathname.includes("/auth/v1/user")) body = user;
      if (url.pathname.includes("/rest/v1/profiles")) {
        body = {
          id: "fixture-profile",
          is_internal_tester: scenario !== "ordinary-user",
          is_admin: false,
        };
      }
      if (url.pathname.endsWith("/paypal-checkout")) {
        const input = route.request().postDataJSON();
        calls.push(input.action);
        expect(Object.keys(input).sort()).toEqual(["action", "paymentId"]);
        expect(input.paymentId).toBe("fixture-payment");
        body = scenario === "failure"
          ? { error: "Payment outcome requires reconciliation." }
          : {
            state: scenario === "pending"
              ? "reconciliation_required"
              : scenario,
            bookingConfirmed: false,
            depositStatus: "disabled",
          };
        if (scenario === "failure") status = 502;
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    const query = scenario === "missing-reference"
      ? ""
      : `?payment_id=fixture-payment${
        scenario === "cancelled" ? "&cancelled=true" : ""
      }&token=untrusted-query-token`;
    await page.goto(`/booking/paypal/return${query}`);
    if (scenario === "ordinary-user") {
      await expect(page).toHaveURL(/\/fleet$/);
      expect(calls).toEqual([]);
      return;
    }
    await expect(
      page.getByRole("heading", { name: "Internal PayPal checkout" }),
    ).toBeVisible();
    const message = scenario === "paid"
      ? "This trip is not confirmed"
      : scenario === "cancelled"
      ? "No trip was confirmed"
      : scenario === "failure"
      ? "requires reconciliation"
      : scenario === "missing-reference"
      ? "Payment reference is missing"
      : "payment is not confirmed";
    await expect(page.getByRole("status")).toContainText(message);
    expect(calls).toEqual(
      scenario === "missing-reference"
        ? []
        : [scenario === "cancelled" ? "cancel" : "capture"],
    );
    if (scenario !== "missing-reference") {
      await page.getByRole("button", { name: "Check payment status" }).click();
      await expect.poll(() => calls.length).toBe(2);
      expect(calls[1]).toBe("status");
    }
  });
}
