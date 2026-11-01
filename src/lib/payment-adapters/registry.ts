// SDKs and processor-specific presentation remain inside their adapters.
export const rentalCheckoutAdapters = {
  square: { available: true, load: () => import("@/pages/SquareCheckout") },
  paypal: { available: true, load: () => import("@/pages/PayPalCheckout") },
  // Contract reserved; no SDK, credentials, or financial requests until implemented.
  authorize_net: { available: false },
} as const;
