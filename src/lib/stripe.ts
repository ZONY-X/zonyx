import { calculateAuthorizationHold } from "./authorizationHold";

export interface StripeCheckoutPayload {
  bookingId: string;
  agreementId: string;
}

export interface StripeCheckoutResponse {
  url: string;
  sessionId: string;
}

export const ZONYX_SERVICE_FEE_RATE = 0.12;
export const ZONYX_TAX_RATE = 0.08;

export { calculateAuthorizationHold };

// Retired customer API. Historical refunds and holds retain their own handlers.
export async function createStripeCheckoutSession(_payload: StripeCheckoutPayload): Promise<StripeCheckoutResponse> {
  throw new Error("Stripe is unavailable for new checkout.");
}
