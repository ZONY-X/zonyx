export interface StripeCheckoutPayload {
  vehicleId: string;
  vehicleName: string;
  vehiclePrice: number;
  startDate: string;
  endDate: string;
  nights: number;
  subtotal: number;
  serviceFee: number;
  taxes: number;
  total: number;
  addOns: Array<{ key: string; title: string; price: number }>;
}

export interface StripeCheckoutResponse {
  url: string;
  sessionId: string;
}

export const ZONYX_SERVICE_FEE_RATE = 0.12;
export const ZONYX_TAX_RATE = 0.08;

export async function createStripeCheckoutSession(payload: StripeCheckoutPayload): Promise<StripeCheckoutResponse> {
  const fallbackUrl = import.meta.env.VITE_STRIPE_CHECKOUT_URL || "https://checkout.stripe.com/pay/cs_test_example";
  const apiBaseUrl = import.meta.env.VITE_STRIPE_API_URL;

  if (apiBaseUrl) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/stripe/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.url) {
          return {
            url: data.url,
            sessionId: data.sessionId || `mock_${Date.now()}`,
          };
        }
      }
    } catch {
      // Fall back to the hosted checkout URL when the API endpoint is unavailable.
    }
  }

  return {
    url: fallbackUrl,
    sessionId: `mock_${Date.now()}`,
  };
}
