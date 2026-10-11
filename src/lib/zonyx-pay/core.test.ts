import { describe, expect, it, vi } from "vitest";
import { PaymentOrchestrator, validatePaymentRequest, type PaymentAdapter, type PaymentRequest } from "./core";

const request: PaymentRequest = {
  operationId: "op-1", bookingId: "booking-1", merchantId: "zonyx",
  provider: "fixture", idempotencyKey: "stable-key",
  amount: { currency: "USD", amountMinor: 12500 },
};
const outcome = { operationId: "op-1", provider: "fixture", status: "captured" as const, occurredAt: "2026-10-11T00:00:00Z" };

describe("ZONYX Pay Core", () => {
  it("rejects invalid amounts and missing identities", () => {
    expect(() => validatePaymentRequest({ ...request, amount: { currency: "USD", amountMinor: 0 } })).toThrow();
    expect(() => validatePaymentRequest({ ...request, amount: { currency: "USD", amountMinor: 1.5 } })).toThrow();
    expect(() => validatePaymentRequest({ ...request, idempotencyKey: "" })).toThrow();
  });

  it("fails closed for unconfigured providers", async () => {
    const orchestrator = new PaymentOrchestrator(new Map());
    await expect(orchestrator.execute("charge", request)).rejects.toThrow("not configured");
  });

  it("dispatches only to the explicitly selected provider", async () => {
    const charge = vi.fn().mockResolvedValue(outcome);
    const adapter = { provider: "fixture", charge } as unknown as PaymentAdapter;
    const orchestrator = new PaymentOrchestrator(new Map([["fixture", adapter]]));
    await expect(orchestrator.execute("charge", request)).resolves.toEqual(outcome);
    expect(charge).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("propagates unknown results without switching providers", async () => {
    const charge = vi.fn().mockResolvedValue({ ...outcome, status: "unknown" });
    const adapter = { provider: "fixture", charge } as unknown as PaymentAdapter;
    const orchestrator = new PaymentOrchestrator(new Map([["fixture", adapter]]));
    const result = await orchestrator.execute("charge", request);
    expect(result.status).toBe("unknown");
    expect(charge).toHaveBeenCalledTimes(1);
  });
});
