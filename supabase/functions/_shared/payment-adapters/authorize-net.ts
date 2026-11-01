import { PaymentError } from "../payment-policy.ts";
/** Reserved adapter. Implement hosted tokenization, idempotent claims, canonical
 * settlement, deposit authorization and signed webhooks before enabling either flow.
 * Never accept raw PAN/CVV or redirect to another provider from this adapter.
 */
export const authorizeNetAdapter = {
  rental: false,
  renewal: false,
  async checkout(): Promise<never> {
    throw new PaymentError(503, "Secure checkout is awaiting activation. No payment was started.");
  },
} as const;
