import { PaymentError } from "./payment-policy.ts";
import { assertSquareSandbox, type SquareEnv, type SquarePayment } from "./square-policy.ts";
export class SquareClient {
  readonly location: string;
  constructor(private env: SquareEnv, private transport: typeof fetch = fetch, gate = "SQUARE_CHECKOUT_ENABLED") {
    assertSquareSandbox(env, gate);
    this.location = env("SQUARE_SANDBOX_LOCATION_ID") || "";
    if (!this.location || !env("SQUARE_SANDBOX_ACCESS_TOKEN")) throw new PaymentError(503, "Square sandbox configuration is incomplete.");
  }
  private async request(path: string, body?: unknown) {
    try {
      const response = await this.transport(`https://connect.squareupsandbox.com/v2/${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${this.env("SQUARE_SANDBOX_ACCESS_TOKEN")}`, "Content-Type": "application/json", "Square-Version": "2026-09-16" },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Provider rejected request");
      return await response.json();
    } catch { throw new PaymentError(502, "Square outcome requires reconciliation. Check the existing payment; do not switch providers."); }
  }
  async create(input: { token: string; key: string; reference: string; amount: number; hold: boolean }) {
    const result = await this.request("payments", { source_id: input.token, idempotency_key: input.key,
      reference_id: input.reference, location_id: this.location, amount_money: { amount: input.amount, currency: "USD" },
      autocomplete: !input.hold, ...(input.hold ? { delay_action: "CANCEL" } : {}), accept_partial_authorization: false });
    return result.payment as SquarePayment;
  }
  // Recover a lost CreatePayment response without submitting another charge.
  async find(reference: string, createdAt: string) {
    const begin = Date.parse(createdAt);
    if (!Number.isFinite(begin)) throw new PaymentError(409, "Payment recovery timestamp unavailable.");
    let cursor: string | undefined;
    const matches: SquarePayment[] = [];
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ location_id: this.location, begin_time: new Date(begin - 60000).toISOString(), limit: "100", sort_order: "DESC" });
      if (cursor) query.set("cursor", cursor);
      const result = await this.request(`payments?${query}`);
      matches.push(...(result.payments || []).filter((payment: SquarePayment) => payment.reference_id === reference));
      cursor = result.cursor;
      if (!cursor) {
        if (matches.length > 1) throw new PaymentError(409, "Conflicting Square references require reconciliation.");
        return matches.length ? await this.get(matches[0].id) : null;
      }
    }
    throw new PaymentError(503, "Square recovery scan incomplete. No new payment was started.");
  }
  async get(id: string) { return (await this.request(`payments/${encodeURIComponent(id)}`)).payment as SquarePayment; }
  async void(id: string) { return (await this.request(`payments/${encodeURIComponent(id)}/cancel`, {})).payment as SquarePayment; }
  async refund(id: string, key: string, amount: number) { return (await this.request("refunds", { payment_id: id, idempotency_key: key, reason: `ZONYX cancellation ${key}`, amount_money: { amount, currency: "USD" } })).refund; }
  async findRefund(paymentId: string, key: string, createdAt: string) {
    const begin = Date.parse(createdAt);
    if (!Number.isFinite(begin)) throw new PaymentError(409, "Refund recovery timestamp unavailable.");
    let cursor: string | undefined;
    const matches: Array<{ id: string }> = [];
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ location_id: this.location, begin_time: new Date(begin - 60000).toISOString(), limit: "100", sort_order: "DESC" });
      if (cursor) query.set("cursor", cursor);
      const result = await this.request(`refunds?${query}`);
      matches.push(...(result.refunds || []).filter((refund: { payment_id: string; reason: string }) => refund.payment_id === paymentId && refund.reason === `ZONYX cancellation ${key}`));
      cursor = result.cursor;
      if (!cursor) {
        if (matches.length > 1) throw new PaymentError(409, "Conflicting Square refunds require reconciliation.");
        return matches.length ? await this.getRefund(matches[0].id) : null;
      }
    }
    throw new PaymentError(503, "Square refund recovery scan incomplete. No new refund was started.");
  }
  async getRefund(id: string) { return (await this.request(`refunds/${encodeURIComponent(id)}`)).refund; }
  // No CompletePayment method: security deposits cannot be captured in this release.
}
