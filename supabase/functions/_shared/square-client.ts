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
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
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
  async get(id: string) { return (await this.request(`payments/${encodeURIComponent(id)}`)).payment as SquarePayment; }
  async void(id: string) { return (await this.request(`payments/${encodeURIComponent(id)}/cancel`, {})).payment as SquarePayment; }
  async refund(id: string, key: string, amount: number) { return (await this.request("refunds", { payment_id: id, idempotency_key: key, amount_money: { amount, currency: "USD" } })).refund; }
  async getRefund(id: string) { return (await this.request(`refunds/${encodeURIComponent(id)}`)).refund; }
  // No CompletePayment method: security deposits cannot be captured in this release.
}
