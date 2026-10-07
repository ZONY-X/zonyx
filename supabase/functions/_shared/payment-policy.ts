export type PaymentProvider = "stripe" | "paypal" | (string & {});
export type RentalPaymentState =
  | "creating"
  | "awaiting_approval"
  | "capturing"
  | "paid"
  | "failed"
  | "cancelled"
  | "reconciliation_required";
export class PaymentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export function assertInternalCheckout(
  enabled: string | undefined,
  internalTest: unknown,
  tester: boolean,
) {
  if (enabled !== "true" || internalTest !== true || !tester) {
    throw new PaymentError(
      403,
      "PayPal checkout is limited to approved internal testing.",
    );
  }
}
// Preparation deployments cannot activate PayPal before the coordinated Stripe
// provider reservation is deployed and verified. This is an operator release
// attestation, not automatic discovery of the deployed Stripe function.
export function assertPayPalProviderLockReady(env: (name: string) => string | undefined) {
  if (env("PAYPAL_PROVIDER_LOCK_READY") !== "true") {
    throw new PaymentError(503, "PayPal coordinated provider locking is not activated.");
  }
}
export function paypalEnvironment(env: (name: string) => string | undefined) {
  const environment = env("PAYPAL_ENVIRONMENT") || "sandbox";
  if (environment !== "sandbox" && environment !== "live") {
    throw new PaymentError(503, "Invalid PayPal environment.");
  }
  if (
    environment === "live" &&
    env("PAYPAL_LIVE_RENTAL_PAYMENT_ENABLED") !== "true"
  ) throw new PaymentError(503, "Live PayPal rental payments are disabled.");
  return environment;
}
export function assertAmountIntegrity(
  booking: Record<string, unknown>,
  summary: Record<string, unknown>,
) {
  for (
    const [bookingKey, summaryKey] of [
      ["subtotal_cents", "subtotal_cents"],
      ["service_fee_cents", "service_fee_cents"],
      ["taxes_cents", "taxes_cents"],
      ["grand_total_cents", "final_total_cents"],
    ]
  ) {
    const amount = booking[bookingKey];
    if (
      typeof amount !== "number" || !Number.isSafeInteger(amount) ||
      amount < 0 || amount !== summary[summaryKey]
    ) {
      throw new PaymentError(
        409,
        "Booking financial terms do not match the accepted Rental Agreement.",
      );
    }
  }
  if (
    Number(booking.grand_total_cents) < 50 ||
    String(booking.currency).toLowerCase() !== "usd" ||
    summary.currency !== "usd"
  ) {
    throw new PaymentError(
      409,
      "Unsupported rental payment amount or currency.",
    );
  }
  return Number(booking.grand_total_cents);
}
export function paypalCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) {
    throw new PaymentError(409, "Invalid PayPal amount.");
  }
  const cents = Number(value.replace(".", ""));
  if (!Number.isSafeInteger(cents)) {
    throw new PaymentError(409, "Invalid PayPal amount.");
  }
  return cents;
}
export type PayPalOrder = {
  id: string;
  intent: string;
  status: string;
  payment_source?: {
    card?: {
      authentication_result?: {
        liability_shift?: string;
        three_d_secure?: {
          enrollment_status?: string;
          authentication_status?: string;
        };
      };
    };
    paypal?: unknown;
  };
  purchase_units?: Array<
    {
      reference_id?: string;
      custom_id?: string;
      amount?: { value: string; currency_code: string };
      payments?: {
        captures?: Array<
          {
            id: string;
            status: string;
            final_capture?: boolean;
            amount: { value: string; currency_code: string };
          }
        >;
      };
    }
  >;
  links?: Array<{ rel: string; href: string }>;
};
export function validatePayPalOrder(
  order: PayPalOrder,
  payment: {
    id: string;
    order_id: string | null;
    amount_cents: number;
    currency: string;
  },
) {
  const units = order.purchase_units;
  if (
    !order.id || (payment.order_id && order.id !== payment.order_id) ||
    order.intent !== "CAPTURE" || units?.length !== 1 ||
    units[0].custom_id !== payment.id || units[0].reference_id !== payment.id ||
    units[0].amount?.currency_code !== payment.currency.toUpperCase() ||
    paypalCents(units[0].amount?.value) !== payment.amount_cents
  ) {
    throw new PaymentError(
      409,
      "PayPal order does not match the persisted rental payment.",
    );
  }
  const captures = units[0].payments?.captures || [];
  if (captures.length > 1) {
    throw new PaymentError(409, "Multiple captures require reconciliation.");
  }
  const capture = captures[0];
  if (
    capture &&
    (!capture.id ||
      capture.amount.currency_code !== payment.currency.toUpperCase() ||
      paypalCents(capture.amount.value) !== payment.amount_cents)
  ) throw new PaymentError(409, "PayPal capture amount mismatch.");
  return capture;
}
export function approvalUrl(order: PayPalOrder, environment: string) {
  const link = order.links?.find((link) =>
    link.rel === "payer-action" || link.rel === "approve"
  );
  if (!link) throw new PaymentError(409, "PayPal approval is unavailable.");
  const url = new URL(link.href);
  const host = environment === "live"
    ? "www.paypal.com"
    : "www.sandbox.paypal.com";
  if (
    url.protocol !== "https:" || url.hostname !== host || url.username ||
    url.password || url.port
  ) throw new PaymentError(409, "Invalid PayPal approval URL.");
  return url.toString();
}
// Automatic post-payment hook. No authorization request exists in this release,
// even when someone accidentally enables the flag. A verified adapter is required.
export function planSecurityDeposit(enabled: string | undefined) {
  return {
    provider: "paypal",
    intent: "AUTHORIZE",
    status: enabled === "true"
      ? "capability_verification_required"
      : "disabled",
    canAuthorize: false,
    renewalRequired: true,
  } as const;
}

// Internal card rollout fails closed on missing/unverified 3DS evidence.
// No merchant-liability exemption is enabled without a reviewed risk policy.
export function assertCardCaptureEligible(order: PayPalOrder) {
  const authentication = order.payment_source?.card?.authentication_result;
  const status = authentication?.three_d_secure?.authentication_status;
  const enrollment = authentication?.three_d_secure?.enrollment_status;
  if (
    authentication?.liability_shift !== "POSSIBLE" ||
    (status !== undefined && !["Y", "A"].includes(status)) ||
    (enrollment !== undefined && enrollment !== "Y")
  ) {
    throw new PaymentError(
      409,
      "Card authentication could not be verified. No capture was initiated. Check this existing payment or contact support.",
    );
  }
}
