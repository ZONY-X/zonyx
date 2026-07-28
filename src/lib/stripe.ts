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
  const supabaseProjectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseAnonKey) {
    throw new Error("Supabase configuration is missing.");
  }

  const functionBaseUrl = supabaseUrl
    ? new URL("/functions/v1/stripe-checkout", supabaseUrl.endsWith("/") ? supabaseUrl : `${supabaseUrl}/`).toString()
    : supabaseProjectId
      ? `https://${supabaseProjectId}.supabase.co/functions/v1/stripe-checkout`
      : null;

  if (!functionBaseUrl) {
    throw new Error("Supabase configuration is missing.");
  }

  const response = await fetch(functionBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let data: { url?: string; sessionId?: string; error?: string } | null = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      // Ignore non-JSON responses and surface the raw text as an error.
    }
  }

  if (!response.ok) {
    const message = data?.error || responseText || "Unable to create Stripe checkout session.";
    throw new Error(message);
  }

  if (!data?.url) {
    throw new Error(responseText || "The checkout session did not return a URL.");
  }

  return {
    url: data.url,
    sessionId: data.sessionId || `stripe_${Date.now()}`,
  };
}
