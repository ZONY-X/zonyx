import { authorizeNetAdapter } from "./authorize-net.ts";
import { PaymentError } from "../payment-policy.ts";
export type Provider = "square" | "paypal" | "authorize_net";
export type Environment = (name: string) => string | undefined;
export const paymentAdapters = {
  square: { rental: true, renewal: true },
  paypal: { rental: true, renewal: false },
  authorize_net: authorizeNetAdapter,
} as const;

/** Pure adapter capability resolver. Runtime configuration supplies the selection. */
export function activePaymentProvider(provider: unknown): Provider {
  if (typeof provider !== "string" || !Object.hasOwn(paymentAdapters, provider)) {
    throw new PaymentError(503, "Secure checkout configuration is unavailable: active processor must be explicitly set to a supported provider. No payment was started.");
  }
  return provider as Provider;
}
export function resolvePaymentProvider(selection: unknown, existing?: string | null, flow: "rental" | "renewal" = "rental"): string {
  // Historical providers survive active config changes (including invalid config).
  if (existing) return existing;
  const provider = activePaymentProvider(selection);
  if (!paymentAdapters[provider][flow]) throw new PaymentError(503, "Secure checkout is awaiting activation. No payment was started.");
  return provider;
}
