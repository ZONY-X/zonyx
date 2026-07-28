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
  authorizationHold?: number;
  total: number;
  addOns: Array<{ key: string; title: string; price: number }>;
}

export interface StripeCheckoutResponse {
  url: string;
  sessionId: string;
}

export const ZONYX_SERVICE_FEE_RATE = 0.12;
export const ZONYX_TAX_RATE = 0.08;

export function calculateAuthorizationHold(vehicleType: string, rentalDays: number): number {
  const normalizedVehicleType = vehicleType.trim().toLowerCase();
  const days = Math.max(1, Math.round(rentalDays));

  if (normalizedVehicleType.includes("model 3")) {
    if (days <= 10) return 500;
    if (days <= 20) return 750;
    return 1000;
  }

  if (normalizedVehicleType.includes("model y")) {
    if (days <= 3) return 500;
    if (days <= 10) return 750;
    if (days <= 20) return 1000;
    return 1250;
  }

  if (normalizedVehicleType.includes("r1s") || normalizedVehicleType.includes("rivian")) {
    if (days <= 3) return 750;
    if (days <= 10) return 1000;
    if (days <= 20) return 1250;
    return 1500;
  }

  if (normalizedVehicleType.includes("cybertruck")) {
    if (days <= 3) return 750;
    if (days <= 10) return 1000;
    if (days <= 20) return 1500;
    return 2000;
  }

  return 0;
}

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
