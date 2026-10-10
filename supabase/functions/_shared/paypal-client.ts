import {
  PaymentError,
  paypalEnvironment,
  type PayPalOrder,
} from "./payment-policy.ts";
export class PayPalClient {
  readonly environment: "sandbox" | "live";
  private base: string;
  private token?: string;
  constructor(
    private env: (name: string) => string | undefined,
    private transport: typeof fetch = fetch,
  ) {
    this.environment = paypalEnvironment(env);
    this.base = this.environment === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  }
  // SDK initialization credentials have a separate, browser-safe OAuth scope.
  // Never return or reuse the privileged REST access token here.
  async browserClientToken() {
    const prefix = this.environment === "live" ? "PAYPAL" : "PAYPAL_SANDBOX";
    const id = this.env(`${prefix}_CLIENT_ID`),
      secret = this.env(`${prefix}_CLIENT_SECRET`);
    if (!id || !secret) {
      throw new PaymentError(
        503,
        "PayPal environment credentials are not configured.",
      );
    }
    try {
      const response = await this.transport(`${this.base}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body:
          "grant_type=client_credentials&response_type=client_token&intent=sdk_init",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (typeof data.access_token !== "string" || !data.access_token) {
        throw new Error();
      }
      return data.access_token as string;
    } catch {
      throw new PaymentError(502, "Card initialization is unavailable.");
    }
  }
  private async accessToken() {
    if (this.token) return this.token;
    // Existing LIVE secrets are never used against the sandbox.
    const prefix = this.environment === "live" ? "PAYPAL" : "PAYPAL_SANDBOX";
    const id = this.env(`${prefix}_CLIENT_ID`),
      secret = this.env(`${prefix}_CLIENT_SECRET`);
    if (!id || !secret) {
      throw new PaymentError(
        503,
        "PayPal environment credentials are not configured.",
      );
    }
    let response: Response;
    try {
      response = await this.transport(`${this.base}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new PaymentError(502, "PayPal authentication is unavailable.");
    }
    if (!response.ok) {
      throw new PaymentError(502, "PayPal authentication failed.");
    }
    const data = await response.json();
    if (typeof data.access_token !== "string") {
      throw new PaymentError(502, "PayPal authentication failed.");
    }
    this.token = data.access_token;
    return this.token;
  }
  async request<T>(
    path: string,
    body?: unknown,
    requestId?: string,
  ): Promise<T> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.transport(`${this.base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new PaymentError(
        502,
        "PayPal outcome is unknown; reconciliation is required. Do not start a new payment.",
      );
    }
    if (!response.ok) {
      throw new PaymentError(
        502,
        "PayPal request was not completed. Reconcile the existing payment before retrying.",
      );
    }
    return response.json();
  }
  async getOrder(id: string) {
    const path = `/v2/checkout/orders/${encodeURIComponent(id)}`;
    // fields=payment_source is a projection: it omits intent, status and
    // purchase_units. Read canonical financial evidence independently, then
    // join authentication evidence only when both responses identify this order.
    const order = await this.request<PayPalOrder>(path);
    const source = await this.request<PayPalOrder>(`${path}?fields=payment_source`);
    if (order.id !== id || source.id !== id) {
      throw new PaymentError(409, "PayPal order identity mismatch.");
    }
    return { ...order, payment_source: source.payment_source ?? order.payment_source };
  }
  createOrder(body: unknown, key: string) {
    return this.request<PayPalOrder>("/v2/checkout/orders", body, key);
  }
  captureOrder(id: string, key: string) {
    return this.request<PayPalOrder>(
      `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
      {},
      key,
    );
  }
  authorizeOrder(id: string, key: string) {
    return this.request<PayPalOrder>(
      `/v2/checkout/orders/${encodeURIComponent(id)}/authorize`, {}, key,
    );
  }
  async voidAuthorization(id: string, key: string) {
    // PayPal returns HTTP 204 for a successful void, without JSON.
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.transport(`${this.base}/v2/payments/authorizations/${encodeURIComponent(id)}/void`, {
        method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","PayPal-Request-Id":key},signal:AbortSignal.timeout(20000),
      });
    } catch { throw new PaymentError(502,"Release outcome is unknown. Check this existing authorization; do not retry blindly."); }
    if (response.status !== 204) throw new PaymentError(502,"Release was not verified. Reconcile the existing authorization.");
  }
  getAuthorization(id: string) { return this.request<PayPalFinancialResource>(`/v2/payments/authorizations/${encodeURIComponent(id)}`); }
  getCapture(id: string) { return this.request<PayPalFinancialResource>(`/v2/payments/captures/${encodeURIComponent(id)}`); }
  async findCancellationRefund(captureId: string, orderId: string, since: string) {
    const date=Date.parse(since);
    if(!Number.isFinite(date) || date<Date.now()-3*86400000) throw new PaymentError(409,"Refund history window requires operator reconciliation. No retry was sent.");
    const query=new URLSearchParams({event_type:"PAYMENT.CAPTURE.REFUNDED",start_time:new Date(date-300000).toISOString().replace(/\.\d{3}Z$/, "Z"),end_time:new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),page_size:"20"});
    const result=await this.request<{events?:Array<{resource?:PayPalFinancialResource}>}>(`/v1/notifications/webhooks-events?${query}`);
    const bases=this.environment==='sandbox'?['https://api-m.sandbox.paypal.com','https://api.sandbox.paypal.com']:['https://api-m.paypal.com','https://api.paypal.com'];
    const candidates=[...new Set((result.events||[]).filter(event=>{
      const resource=event.resource;
      return resource?.supplementary_data?.related_ids?.capture_id===captureId || resource?.supplementary_data?.related_ids?.order_id===orderId || resource?.links?.some(link=>link.rel==='up' && bases.some(base=>link.href===`${base}/v2/payments/captures/${encodeURIComponent(captureId)}`));
    }).map(event=>event.resource?.id).filter((id):id is string=>typeof id==='string'))];
    if(candidates.length!==1)throw new PaymentError(409,"Refund identity is not uniquely available. Wait for authenticated webhook recovery; no retry was sent.");
    return candidates[0];
  }
  getRefund(id: string) { return this.request<PayPalFinancialResource>(`/v2/payments/refunds/${encodeURIComponent(id)}`); }
  refundCapture(id: string, amountCents: number, currency: string, key: string) {
    return this.request<PayPalFinancialResource>(`/v2/payments/captures/${encodeURIComponent(id)}/refund`,
      {amount:{value:(amountCents/100).toFixed(2),currency_code:currency.toUpperCase()}},key);
  }
  async verifyWebhook(headers: Headers, event: unknown, webhookId: string) {
    const cert = headers.get("paypal-cert-url") || "";
    let certUrl: URL;
    try {
      certUrl = new URL(cert);
    } catch {
      return false;
    }
    const certificateOrigins = this.environment === "live"
      ? ["https://api-m.paypal.com", "https://api.paypal.com"]
      : ["https://api-m.sandbox.paypal.com", "https://api.sandbox.paypal.com"];
    if (
      !certificateOrigins.includes(certUrl.origin) ||
      !certUrl.pathname.startsWith("/v1/notifications/certs/") ||
      certUrl.username || certUrl.password
    ) return false;
    const fields = [
      "paypal-auth-algo",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ];
    if (fields.some((field) => !headers.get(field))) return false;
    const result = await this.request<{ verification_status: string }>(
      "/v1/notifications/verify-webhook-signature",
      {
        auth_algo: headers.get(fields[0]),
        cert_url: cert,
        transmission_id: headers.get(fields[1]),
        transmission_sig: headers.get(fields[2]),
        transmission_time: headers.get(fields[3]),
        webhook_id: webhookId,
        webhook_event: event,
      },
    );
    return result.verification_status === "SUCCESS";
  }
}

export type PayPalFinancialResource = {id:string;status:string;amount:{value:string;currency_code:string};expiration_time?:string;create_time?:string;supplementary_data?:{related_ids?:{order_id?:string;capture_id?:string}};links?:Array<{rel:string;href:string}>};
