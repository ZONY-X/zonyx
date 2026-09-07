// Module 1B: pure decision logic for security-deposit hold release/capture.
// No I/O, no Stripe SDK, no Supabase — fully unit-testable. The edge function
// combines this plan with live Stripe + database state and performs the calls.

export type HoldAction = "release" | "capture";

export interface HoldActionPlan {
  ok: boolean;
  stripeAction: "cancel" | "capture" | "none";
  stripeAmountCents?: number;
  persistStatus?: "released" | "captured";
  alreadyFinalized?: boolean;
  error?: string;
  httpStatus: number;
}

/** DB-level final statuses written by persist_authorization_hold_outcome. */
export const FINAL_HOLD_STATUSES = ["released", "captured"] as const;

/**
 * Validates the raw request body of the manage-authorization-hold function.
 * Returns normalized values or an error message.
 */
export function parseHoldRequest(body: unknown): {
  ok: boolean;
  bookingId?: string;
  action?: HoldAction;
  amountCents?: number;
  error?: string;
} {
  const raw = (body ?? {}) as Record<string, unknown>;
  const bookingId = typeof raw.bookingId === "string" ? raw.bookingId.trim() : "";
  const action = raw.action;

  if (!bookingId) {
    return { ok: false, error: "A bookingId is required." };
  }
  if (action !== "release" && action !== "capture") {
    return { ok: false, error: "action must be \"release\" or \"capture\"." };
  }

  let amountCents: number | undefined;
  if (action === "capture") {
    const value = raw.amountCents;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { ok: false, error: "A whole-number amountCents is required for capture." };
    }
    if (value <= 0) {
      return { ok: false, error: "Capture amount must be greater than zero." };
    }
    amountCents = value;
  }

  return { ok: true, bookingId, action, amountCents };
}

/**
 * Decides the safe sequence of Stripe + persistence steps for a hold,
 * given the stored database state and the live Stripe PaymentIntent state.
 * Performs no I/O itself and never moves money.
 */
export function planHoldAction(input: {
  action: HoldAction;
  dbHoldStatus?: string | null;
  dbPaymentIntentId?: string | null;
  stripePaymentIntentStatus?: string | null;
  stripeCapturableCents?: number | null;
  requestedAmountCents?: number | null;
  captureBeforeMs?: number | null;
  nowMs?: number;
}): HoldActionPlan {
  const {
    action,
    dbHoldStatus,
    dbPaymentIntentId,
    stripePaymentIntentStatus,
    stripeCapturableCents,
    requestedAmountCents,
    captureBeforeMs,
    nowMs,
  } = input;

  if (!dbPaymentIntentId) {
    return {
      ok: false,
      stripeAction: "none",
      error: "No security-deposit authorization exists for this booking.",
      httpStatus: 409,
    };
  }

  const dbFinalized = (FINAL_HOLD_STATUSES as readonly string[]).includes(dbHoldStatus ?? "");

  if (action === "release") {
    if (dbFinalized) {
      return {
        ok: true,
        stripeAction: "none",
        persistStatus: dbHoldStatus === "captured" ? "captured" : "released",
        alreadyFinalized: true,
        httpStatus: 200,
      };
    }
    if (stripePaymentIntentStatus === "canceled") {
      // Authorization was already voided on Stripe's side; converge the record.
      return { ok: true, stripeAction: "none", persistStatus: "released", httpStatus: 200 };
    }
    if (stripePaymentIntentStatus === "requires_capture") {
      return { ok: true, stripeAction: "cancel", persistStatus: "released", httpStatus: 200 };
    }
    if (stripePaymentIntentStatus === "succeeded") {
      return {
        ok: false,
        stripeAction: "none",
        error: "The deposit was already captured and cannot be released.",
        httpStatus: 409,
      };
    }
    return {
      ok: false,
      stripeAction: "none",
      error: `Authorization is not releasable (PaymentIntent status: ${stripePaymentIntentStatus ?? "unknown"}).`,
      httpStatus: 409,
    };
  }

  // action === "capture"
  if (dbHoldStatus === "captured") {
    return {
      ok: false,
      stripeAction: "none",
      error: "The deposit has already been captured.",
      httpStatus: 409,
    };
  }
  if (dbHoldStatus === "released") {
    return {
      ok: false,
      stripeAction: "none",
      error: "The deposit has already been released and cannot be captured.",
      httpStatus: 409,
    };
  }

  const amount = requestedAmountCents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    return {
      ok: false,
      stripeAction: "none",
      error: "Capture amount must be a positive whole number of cents.",
      httpStatus: 400,
    };
  }

  if (
    typeof captureBeforeMs === "number" &&
    captureBeforeMs > 0 &&
    typeof nowMs === "number" &&
    nowMs > captureBeforeMs
  ) {
    return {
      ok: false,
      stripeAction: "none",
      error: "The authorization has expired and can no longer be captured. Release the deposit instead.",
      httpStatus: 409,
    };
  }

  const capturable =
    typeof stripeCapturableCents === "number" && stripeCapturableCents > 0
      ? stripeCapturableCents
      : 0;

  if (stripePaymentIntentStatus !== "requires_capture") {
    return {
      ok: false,
      stripeAction: "none",
      error: `Authorization is not capturable (PaymentIntent status: ${stripePaymentIntentStatus ?? "unknown"}).`,
      httpStatus: 409,
    };
  }
  if (amount > capturable) {
    return {
      ok: false,
      stripeAction: "none",
      error: `Capture amount exceeds the authorized amount (authorized: ${capturable} cents).`,
      httpStatus: 400,
    };
  }

  return {
    ok: true,
    stripeAction: "capture",
    stripeAmountCents: amount,
    persistStatus: "captured",
    httpStatus: 200,
  };
}
