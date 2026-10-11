export const PRIMARY_CHECKOUT_PROVIDER = "square" as const;
export const ALTERNATIVE_CHECKOUT_PROVIDER = "paypal" as const;
export function chooseCheckoutProvider(squareEnabled: boolean, paypalEnabled: boolean, existing?: string | null): "square" | "paypal" {
  if (existing === "square" || existing === "paypal") return existing;
  if (existing) throw new Error("This booking has an existing payment. Contact support to manage it.");
  if (squareEnabled) return PRIMARY_CHECKOUT_PROVIDER;
  if (paypalEnabled) return ALTERNATIVE_CHECKOUT_PROVIDER;
  throw new Error("Secure checkout is awaiting activation. No payment was started.");
}
