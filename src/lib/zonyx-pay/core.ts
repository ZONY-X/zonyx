/**
 * ZONYX Pay Core — provider-neutral payment domain contracts.
 * No network calls, card data, secrets, or production activation.
 * Monetary amounts are integer minor units (USD cents).
 */
export type PaymentProviderId = "stripe" | "paypal" | (string & {});
export type PaymentOperation = "charge" | "authorize" | "capture" | "void" | "refund";
export type PaymentStatus =
  | "created" | "pending" | "requires_action" | "authorized"
  | "captured" | "voided" | "refunded" | "failed" | "unknown";

export interface Money {
  currency: "USD";
  amountMinor: number;
}

export interface PaymentRequest {
  operationId: string;
  bookingId: string;
  merchantId: string;
  provider: PaymentProviderId;
  idempotencyKey: string;
  amount: Money;
  paymentReference?: string;
}

export interface PaymentOutcome {
  operationId: string;
  provider: PaymentProviderId;
  status: PaymentStatus;
  providerReference?: string;
  occurredAt: string;
}

export interface PaymentAdapter {
  readonly provider: PaymentProviderId;
  charge(request: PaymentRequest): Promise<PaymentOutcome>;
  authorize(request: PaymentRequest): Promise<PaymentOutcome>;
  capture(request: PaymentRequest): Promise<PaymentOutcome>;
  void(request: PaymentRequest): Promise<PaymentOutcome>;
  refund(request: PaymentRequest): Promise<PaymentOutcome>;
  reconcile(operationId: string): Promise<PaymentOutcome>;
}

export function validatePaymentRequest(request: PaymentRequest): void {
  if (!request.operationId || !request.bookingId || !request.merchantId || !request.provider || !request.idempotencyKey) {
    throw new Error("Missing required payment identity");
  }
  if (request.amount.currency !== "USD" || !Number.isSafeInteger(request.amount.amountMinor) || request.amount.amountMinor <= 0) {
    throw new Error("Invalid payment amount");
  }
}

export class PaymentOrchestrator {
  constructor(private readonly adapters: ReadonlyMap<string, PaymentAdapter>) {}

  async execute(operation: PaymentOperation, request: PaymentRequest): Promise<PaymentOutcome> {
    validatePaymentRequest(request);
    const adapter = this.adapters.get(request.provider);
    if (!adapter) throw new Error("Payment provider not configured");
    // The caller must persist a durable, unique operation claim BEFORE invoking this method.
    // Never retry an ambiguous financial POST against a different provider.
    return adapter[operation](request);
  }

  async reconcile(provider: string, operationId: string): Promise<PaymentOutcome> {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error("Payment provider not configured");
    if (!operationId) throw new Error("Missing operation identity");
    return adapter.reconcile(operationId);
  }
}
