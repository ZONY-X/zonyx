import { supabase } from "@/integrations/supabase/client";
import type { PaymentProvider } from "../payments";
export async function paypalAction(
  input: {
    action:
      | "create"
      | "capture"
      | "cancel"
      | "status"
      | "client-token"
      | "checkout-config"
      | "deposit-create"
      | "deposit-authorize"
      | "deposit-status"
      | "deposit-auto-authorize";
    method?: "card" | "paypal_wallet";
    bookingId?: string;
    agreementId?: string;
    paymentId?: string;
    paymentSourceId?: string;
  },
) {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) {
    throw new Error("Sign in to continue to secure checkout.");
  }
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error("Supabase configuration is missing.");
  let response: Response;
  try {
    response = await fetch(new URL(input.action.startsWith("deposit-") ? "/functions/v1/paypal-deposit" : "/functions/v1/paypal-checkout", base), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.session.access_token}`,
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.action.startsWith("deposit-") ? {action: input.action.slice(8), paymentId: input.paymentId} : input),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(
      "Payment outcome is unknown. Check this existing payment before trying again.",
    );
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error.replace(/\b(Square|PayPal)\b/g, "payment processor")
        : "Unable to process this payment.",
    );
  }
  return data as {
    existingPayment?: {
      id: string;
      state: string;
      checkout_method: "card" | "paypal_wallet";
    };
    cardEnabled?: boolean;
    walletEnabled?: boolean;
    depositEnabled?: boolean;
    checkoutBlockReason?: string;
    checkoutAvailableAt?: string;
    depositDeferred?: boolean;
    depositDueAt?: string;
    depositScheduled?: boolean;
    pickupReady?: boolean;
    notificationStatus?: "sent" | "pending";
    depositAmountCents?: number;
    amountCents?: number;
    currency?: string;
    clientToken?: string;
    environment?: "sandbox" | "live";
    orderId?: string;
    provider?: PaymentProvider;
    url?: string;
    paymentId?: string;
    state?: string;
    depositStatus?: string;
    operationState?: string;
    approvalReady?: boolean;
    tripStatus?: string;
    refundedAmountCents?: number;
    bookingConfirmed?: boolean;
    authorizationDueAt?: string;
  };
}
