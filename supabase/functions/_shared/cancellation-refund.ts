/**
 * ZONYX cancellation + refund decision logic (pure, no Stripe/DB/network).
 * Encodes the ZONYX cancellation policy and all money/state guards so the
 * edge function can be a thin executor. Run tests: npx tsx cancellation-refund.test.ts
 */

export const FINAL_TRIP_STATUSES = ["cancelled", "completed"] as const;

/** Trip statuses where an in-progress trip must never be guest/host cancelled through this flow. */
export const IN_PROGRESS_STATUSES = ["active", "pending_inspection"] as const;

export type ActorRole = "guest" | "host" | "admin";

export type PaymentState = "paid" | "pending" | "unverified" | "none";

export interface PaymentStateInput {
  tripStatus: string;
  grandTotalCents: number;
  hasCheckoutSession: boolean;
}

/**
 * Discriminates the payment state from persisted booking data.
 * - "paid": rental completed checkout (session exists) and has a positive total.
 * - "pending": booking still awaiting payment.
 * - "unverified": booking is past pending_payment but we have no checkout session —
 *   we cannot safely refund money we cannot locate, so callers must reject.
 * - "none": nothing was ever payable (zero total).
 */
export function derivePaymentState(input: PaymentStateInput): PaymentState {
  if (input.tripStatus === "cancelled" || input.tripStatus === "completed") {
    return "none";
  }
  if (input.tripStatus === "pending_payment") return "pending";
  if (input.grandTotalCents <= 0) return "none";
  if (!input.hasCheckoutSession) return "unverified";
  return "paid";
}

export interface CancellationInput {
  tripStatus: string;
  actorRole: ActorRole;
  subtotalCents: number;
  serviceFeeCents: number;
  taxesCents: number;
  grandTotalCents: number;
  /** true when a Stripe checkout session id is persisted (rental payment exists server-side) */
  hasCheckoutSession: boolean;
  /** true when the payment has been located/verified and is refundable */
  hasRefundablePayment: boolean;
}

export type CancellationAction =
  | "cancel_with_refund"
  | "cancel_without_refund"
  | "reject";

export interface CancellationPlan {
  ok: boolean;
  action: CancellationAction;
  /** amount to refund to the ORIGINAL payment (cents) */
  refundCents: number;
  /** portion of the grand total kept by ZONYX (cents) */
  nonRefundableCents: number;
  reason?: string;
}

/**
 * Plans a cancellation per ZONYX policy:
 * - Guest cancellation: refundable portion = subtotal + taxes (insurance is not a
 *   persisted pricing component; service/processing fee is non-refundable).
 * - Host/provider or admin cancellation: FULL refund of everything paid.
 * - active / pending_inspection / completed trips can never cancel here.
 * - already-cancelled stays cancelled (reject duplicates — idempotent).
 * - unpaid/pending_payment may cancel with NO refund.
 * - A PAID booking whose payment cannot be verified must reject BEFORE any
 *   booking state changes (no silent unrefunded cancellations).
 */
export function planBookingCancellation(input: CancellationInput): CancellationPlan {
  const nonRefundable = Math.max(0, input.serviceFeeCents);
  const guestRefundable = Math.max(0, input.subtotalCents) + Math.max(0, input.taxesCents);
  const paid = Math.max(0, input.grandTotalCents);

  if (input.tripStatus === "completed") {
    return { ok: false, action: "reject", refundCents: 0, nonRefundableCents: 0, reason: "Trip is already completed." };
  }
  if (input.tripStatus === "cancelled") {
    return { ok: false, action: "reject", refundCents: 0, nonRefundableCents: 0, reason: "Booking is already cancelled." };
  }
  if ((IN_PROGRESS_STATUSES as readonly string[]).includes(input.tripStatus)) {
    return { ok: false, action: "reject", refundCents: 0, nonRefundableCents: 0, reason: `Trip is already ${input.tripStatus.replace("_", " ")} and cannot be cancelled here.` };
  }

  const paymentState = derivePaymentState({
    tripStatus: input.tripStatus,
    grandTotalCents: input.grandTotalCents,
    hasCheckoutSession: input.hasCheckoutSession,
  });

  if (paymentState === "unverified") {
    return { ok: false, action: "reject", refundCents: 0, nonRefundableCents: 0, reason: "Payment for this booking cannot be verified; contact support before cancelling." };
  }

  if (paymentState !== "paid") {
    // pending_payment (or nothing payable): cancel without any refund.
    return { ok: true, action: "cancel_without_refund", refundCents: 0, nonRefundableCents: 0 };
  }

  if (!input.hasRefundablePayment) {
    // paid booking but the Stripe payment could not be located/verified server-side — fail safely.
    return { ok: false, action: "reject", refundCents: 0, nonRefundableCents: 0, reason: "Original payment could not be verified for refund; contact support." };
  }

  if (input.actorRole === "guest") {
    const refund = Math.min(guestRefundable, paid);
    return { ok: true, action: "cancel_with_refund", refundCents: refund, nonRefundableCents: paid - refund };
  }

  // host / admin (provider cancellation): full refund of all amounts paid.
  return { ok: true, action: "cancel_with_refund", refundCents: paid, nonRefundableCents: 0 };
}
