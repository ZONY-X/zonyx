import { expect, test } from "@playwright/test";
for (
  const scenario of [
    "success",
    "ineligible",
    "disabled",
    "cancelled",
    "failed",
    "capture-error",
    "wrong-order",
    "reload-capturing",
    "ordinary-user",
    "mobile",
    "wallet",
    "sdk-error",
  ] as const
) {
  test(`ZONYX embedded card checkout: ${scenario}`, async ({ page }) => {
    if (scenario === "mobile") {
      await page.setViewportSize({ width: 390, height: 844 });
    }
    const calls: Record<string, unknown>[] = [];
    let scriptCalls = 0;
    await page.route("**/*", async (route) => {
      if (
        ["localhost", "127.0.0.1"].includes(
          new URL(route.request().url()).hostname,
        )
      ) return route.continue();
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
      const encode = (v: unknown) =>
        btoa(JSON.stringify(v)).replaceAll("=", "").replaceAll("+", "-")
          .replaceAll("/", "_");
      const expires_at = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem(
        "sb-fazzuetfwwfiqehpnjky-auth-token",
        JSON.stringify({
          access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${
            encode({ sub: user.id, exp: expires_at, role: "authenticated" })
          }.fixture`,
          refresh_token: "fixture",
          expires_at,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
    }, user);
    await page.route("**/web-sdk/v6/core", async (route) => {
      scriptCalls++;
      if (scenario === "sdk-error") return route.abort();
      await route.fulfill({
        contentType: "application/javascript",
        body:
          `window.paypal={createInstance:async()=>({findEligibleMethods:async()=>({isEligible:()=>${
            scenario !== "ineligible"
          }}),createCardFieldsOneTimePaymentSession:()=>({createCardFieldsComponent:({type,placeholder})=>{const iframe=document.createElement('iframe');iframe.title=placeholder;iframe.style='width:100%;height:100%;border:0';iframe.srcdoc='<style>body{margin:0;background:#050b09}input{box-sizing:border-box;width:100%;height:48px;padding:12px;border:0;border-radius:12px;background:#050b09;color:#e5e7eb;font:16px Arial}</style><input placeholder="'+placeholder+'" aria-label="'+placeholder+'" autocomplete="off">';return iframe;},submit:async(orderId)=>({state:'${
            scenario === "cancelled"
              ? "canceled"
              : scenario === "failed"
              ? "failed"
              : "succeeded"
          }',data:{orderId:${
            scenario === "wrong-order" ? "'wrong-order'" : "orderId"
          }}})})})};`,
      });
    });
    await page.route("**fazzuetfwwfiqehpnjky.supabase.co/**", async (route) => {
      const url = new URL(route.request().url());
      let body: unknown = [];
      let status = 200;
      if (url.pathname.includes("/auth/v1/user")) body = user;
      if (url.pathname.includes("/rest/v1/profiles")) {
        body = {
          id: "profile-fixture",
          is_internal_tester: scenario !== "ordinary-user",
          is_admin: false,
        };
      }
      if (url.pathname.endsWith("/paypal-checkout")) {
        const input = route.request().postDataJSON();
        calls.push(input);
        expect(input).not.toHaveProperty("amount");
        expect(input).not.toHaveProperty("orderId");
        expect(input).not.toHaveProperty("card");
        if (
          input.action === "client-token" || input.action === "checkout-config"
        ) {
          body = {
            cardEnabled: scenario !== "disabled",
            clientToken: scenario !== "disabled"
              ? "synthetic-browser-token"
              : undefined,
            environment: "sandbox",
            amountCents: 12096,
            existingPayment: scenario === "reload-capturing"
              ? {
                id: "payment-fixture",
                state: "capturing",
                checkout_method: "card",
              }
              : null,
          };
        }
        if (input.action === "create") {
          expect(input.method).toBe(
            scenario === "wallet" ? "paypal_wallet" : "card",
          );
          body = {
            paymentId: "payment-fixture",
            orderId: "order-fixture",
            url: scenario === "wallet"
              ? "https://www.sandbox.paypal.com/checkoutnow?token=order-fixture"
              : undefined,
          };
        }
        if (input.action === "capture") {
          body = scenario === "capture-error"
            ? { error: "Unknown outcome" }
            : { state: "paid", bookingConfirmed: false };
          if (scenario === "capture-error") status = 502;
        }
        if (input.action === "status") {
          body = { state: "paid", bookingConfirmed: false };
        }
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.route(
      "https://www.sandbox.paypal.com/checkoutnow**",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<p>Synthetic wallet approval page</p>",
        }),
    );
    await page.goto(
      "/booking/payment?bookingId=booking-fixture&agreementId=agreement-fixture",
    );
    if (scenario === "ordinary-user") {
      await expect(page).toHaveURL(/\/fleet$/);
      expect(calls).toEqual([]);
      expect(scriptCalls).toBe(0);
      return;
    }
    await expect(page.getByRole("heading", { name: "Pay for your rental" }))
      .toBeVisible();
    await expect(page.getByText("Rental total: $120.96")).toBeVisible();
    if (scenario === "wallet") {
      await page.getByRole("button", { name: "PayPal", exact: true }).click();
      await expect(page).toHaveURL(/www\.sandbox\.paypal\.com\/checkoutnow/);
      expect(calls.filter((c) => c.action === "create")).toHaveLength(1);
      expect(calls.filter((c) => c.action === "capture")).toHaveLength(0);
      return;
    }
    const pay = page.getByRole("button", { name: "Pay ZONYX" });
    if (
      ["disabled", "ineligible", "reload-capturing", "sdk-error"].includes(
        scenario,
      )
    ) {
      await expect(pay).toBeDisabled();
      if (scenario === "reload-capturing") {
        await expect(page.getByRole("button", { name: "PayPal", exact: true }))
          .toBeDisabled();
        await page.getByRole("button", { name: "Check payment status" })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "trip is not confirmed",
        );
      } else {
        await expect(page.getByRole("status")).toContainText(
          scenario === "disabled" ? "not enabled" : "unavailable",
        );
        await expect(page.getByRole("button", { name: "PayPal", exact: true }))
          .toBeEnabled();
      }
      if (scenario === "disabled" || scenario === "reload-capturing") {
        expect(scriptCalls).toBe(0);
        expect(calls.filter((c) => c.action === "client-token")).toHaveLength(
          0,
        );
      }
      expect(
        calls.filter((c) => c.action === "create" || c.action === "capture"),
      ).toEqual([]);
      return;
    }
    await expect(page.locator('iframe[title="Card number"]')).toBeVisible();
    await page.frameLocator('iframe[title="Card number"]').getByLabel(
      "Card number",
    ).fill("4111111111111111");
    await page.frameLocator('iframe[title="MM/YY"]').getByLabel("MM/YY").fill(
      "12/38",
    );
    await page.frameLocator('iframe[title="Security code"]').getByLabel(
      "Security code",
    ).fill("123");
    await page.getByLabel("Billing ZIP code (United States)").fill("33131");
    await expect(pay).toBeEnabled();
    await expect(page.getByRole("button", { name: "Apple Pay" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Google Pay" })).toHaveCount(
      0,
    );
    if (scenario === "success" || scenario === "mobile") {
      await page.screenshot({
        path: `/private/tmp/zonyx-card-${scenario}.png`,
        fullPage: true,
      });
    }
    await pay.click();
    await expect(page.getByRole("button", { name: "PayPal", exact: true }))
      .toBeDisabled();
    if (scenario === "cancelled" || scenario === "failed") {
      await expect(page.getByRole("status")).toContainText(
        "No capture was requested",
      );
      expect(calls.filter((c) => c.action === "capture")).toEqual([]);
      await expect(pay).toBeEnabled();
    } else if (scenario === "wrong-order" || scenario === "capture-error") {
      await expect(page.getByRole("status")).toContainText(
        "needs reconciliation",
      );
      await expect(pay).toBeDisabled();
      if (scenario === "wrong-order") {
        expect(calls.filter((c) => c.action === "capture")).toEqual([]);
      }
      await page.getByRole("button", { name: "Check payment status" }).click();
      await expect(page.getByRole("status")).toContainText(
        "trip is not confirmed",
      );
    } else {
      await expect(page.getByRole("status")).toContainText(
        "trip is not confirmed",
      );
      expect(calls.filter((c) => c.action === "capture")).toHaveLength(1);
      await expect(pay).toBeDisabled();
    }
    await expect(page).toHaveURL(/\/booking\/payment\?/);
    if (scenario === "mobile") {
      expect(
        await page.evaluate(() =>
          document.documentElement.scrollWidth <= window.innerWidth
        ),
      ).toBe(true);
    }
  });
}
