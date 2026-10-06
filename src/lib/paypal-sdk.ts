export type CardSubmitResult = {
  state: "succeeded" | "canceled" | "failed" | string;
  data?: { orderId?: string };
};
export type CardSession = {
  createCardFieldsComponent(
    options: {
      type: "number" | "expiry" | "cvv";
      placeholder: string;
      style: Record<string, unknown>;
    },
  ): HTMLElement;
  submit(
    orderId: string,
    options: { billingAddress: { postalCode: string; countryCode: string } },
  ): Promise<CardSubmitResult>;
};
export type PayPalSdk = {
  findEligibleMethods(
    options: { currencyCode: string },
  ): Promise<{ isEligible(method: string): boolean }>;
  createCardFieldsOneTimePaymentSession(): CardSession;
};
type PayPalNamespace = {
  createInstance(
    options: { clientToken: string; components: string[]; pageType: string },
  ): Promise<PayPalSdk>;
};
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}
let scriptLoad:
  | { environment: string; promise: Promise<PayPalNamespace> }
  | undefined;
export function loadPayPalSdk(
  environment: "sandbox" | "live",
): Promise<PayPalNamespace> {
  if (scriptLoad) {
    if (scriptLoad.environment !== environment) {
      return Promise.reject(
        new Error("Payment environment changed. Reload checkout."),
      );
    }
    return scriptLoad.promise;
  }
  // Fixed provider URL, never a client token or user-controlled script source.
  const promise = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = environment === "live"
      ? "https://www.paypal.com/web-sdk/v6/core"
      : "https://www.sandbox.paypal.com/web-sdk/v6/core";
    script.async = true;
    const timeout = window.setTimeout(
      () => reject(new Error("Secure card fields are unavailable.")),
      20000,
    );
    script.onload = () => {
      window.clearTimeout(timeout);
      if (!window.paypal) {
        reject(new Error("Secure card fields are unavailable."));
      } else resolve(window.paypal);
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Secure card fields are unavailable."));
    };
    document.head.appendChild(script);
  });
  scriptLoad = { environment, promise };
  return promise;
}
// Explicit extension registry. No Apple/Google SDK or network requests until a
// separately reviewed adapter, eligibility check, onboarding and gate exist.
export const additionalWallets = [
  { id: "apple_pay", label: "Apple Pay", enabled: false },
  { id: "google_pay", label: "Google Pay", enabled: false },
] as const;

// Future wallet adapters must return the same persisted order identity and use
// the protected server capture. They may never capture through a browser SDK.
export interface AdditionalWalletAdapter {
  id: typeof additionalWallets[number]["id"];
  isEligible(sdk: PayPalSdk): Promise<boolean>;
  approve(orderId: string): Promise<CardSubmitResult>;
}
