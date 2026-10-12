import { PAYMENT_PLATFORM, selectAcquiringRail, type Rail } from "./rail-routing.ts";

/**
 * Customer-facing checkout identity is always ZONYX Pay.
 * The acquiring rail is an internal implementation detail, not a second checkout.
 * Call only BEFORE creating a financial operation claim; existing bookings must remain pinned.
 */
export type ZonyxCheckoutPlan = {
  platform: typeof PAYMENT_PLATFORM;
  acquiringRail: string;
  bookingId: string;
};
export function planZonyxCheckout(input: {
  bookingId: string;
  rails: readonly Rail[];
  existingProvider?: string | null;
}): ZonyxCheckoutPlan {
  if (!input.bookingId?.trim()) throw new Error("Missing booking identity");
  return {
    platform: PAYMENT_PLATFORM,
    acquiringRail: selectAcquiringRail(input.rails, input.existingProvider),
    bookingId: input.bookingId,
  };
}
