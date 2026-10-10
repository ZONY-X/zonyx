import { supabase } from "@/integrations/supabase/client";
import { createStripeCheckoutSession } from "./stripe";
export type PaymentProvider = "stripe" | "paypal" | (string & {});
export type RentalCheckoutInput = { bookingId: string; agreementId: string };
export type RentalCheckout = {
  provider: PaymentProvider;
  url: string;
  paymentId: string;
};
export const internalPayPalCheckoutEnabled = (tester: boolean) =>
  import.meta.env.VITE_PAYPAL_CUSTOMER_CHECKOUT_ENABLED === "true" || (tester && import.meta.env.VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED === "true");
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
      | "deposit-status";
    method?: "card" | "paypal_wallet";
    bookingId?: string;
    agreementId?: string;
    paymentId?: string;
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
        ? data.error
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
    walletEnabled?: false;
    depositEnabled?: boolean;
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
    tripStatus?: string;
    refundedAmountCents?: number;
    bookingConfirmed?: boolean;
  };
}
// Adapter boundary: adding a provider never changes booking/agreement creation.
// Stripe stays available for its existing infrastructure and historical actions.
export async function startRentalCheckout(
  provider: PaymentProvider,
  input: RentalCheckoutInput,
): Promise<RentalCheckout> {
  if (provider === "stripe") {
    const checkout = await createStripeCheckoutSession(input);
    return { provider, url: checkout.url, paymentId: checkout.sessionId };
  }
  if (provider === "paypal") {
    // Booking creation stays provider-neutral; the ZONYX checkout chooses the
    // card/wallet presentation only after the accepted booking is persisted.
    const query = new URLSearchParams(input);
    return {
      provider,
      url: `/booking/payment?${query}`,
      paymentId: input.bookingId,
    };
  }
  throw new Error("This payment provider is not available.");
}
export async function startPayPalWallet(input: RentalCheckoutInput) {
  const checkout = await paypalAction({
    action: "create",
    method: "paypal_wallet",
    ...input,
  });
  if (!checkout.url || !checkout.paymentId) {
    throw new Error("PayPal checkout did not return an approval URL.");
  }
  const url = new URL(checkout.url);
  if (
    url.protocol !== "https:" ||
    !["www.paypal.com", "www.sandbox.paypal.com"].includes(url.hostname)
  ) throw new Error("Invalid PayPal approval URL.");
  return {
    provider: "paypal" as const,
    url: checkout.url,
    paymentId: checkout.paymentId,
  };
}

export type RentalPaymentReceipt = {
  provider: PaymentProvider;
  state: string;
  amountCents: number;
  capturedAmountCents: number;
  currency: string;
  depositStatus: string;
  tripStatus?: string;
  refundedAmountCents?: number;
  refundStatus?: string;
  reconciliationRequired: boolean;
  bookingConfirmed: boolean;
};
export async function getRentalPaymentReceipt(
  bookingId: string,
): Promise<RentalPaymentReceipt | null> {
  if (import.meta.env.VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED !== "true" && import.meta.env.VITE_PAYPAL_CUSTOMER_CHECKOUT_ENABLED !== "true") {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  // Keep this additive read adapter independent of the older generated schema
  // file. The SQL function is SECURITY INVOKER and its tables enforce owner RLS.
  const response = await fetch(
    new URL(
      "/rest/v1/rpc/get_provider_rental_payment_receipt",
      import.meta.env.VITE_SUPABASE_URL,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _booking_id: bookingId }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error("Rental payment receipt is unavailable.");
  return response.json();
}

export async function cancelRentalBooking(input: {bookingId:string;cancelType:string;reason:string;action?:"cancel"|"status"|"release"}) {
  // Routing uses RLS-readable provider truth. The server independently checks
  // ownership, role, original capture, policy amount and terminal hold state.
  const {data:session}=await supabase.auth.getSession();
  if(!session.session)throw new Error("Sign in to manage your booking.");
  const headers={Authorization:`Bearer ${session.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"};
  const providerURL=new URL("/rest/v1/booking_payments",import.meta.env.VITE_SUPABASE_URL);
  providerURL.searchParams.set("select","id,provider");providerURL.searchParams.set("booking_id",`eq.${input.bookingId}`);
  const lookup=await fetch(providerURL,{headers,signal:AbortSignal.timeout(10000)});
  if(!lookup.ok)throw new Error("Payment provider is unavailable. No cancellation was sent.");
  const payments: Array<{id:string;provider:string}>=await lookup.json();
  if(payments.length>1)throw new Error("Conflicting payment records require support.");
  if(payments[0]?.provider!=="paypal") {
    if(input.action==="release") {
      const {data,error}=await supabase.functions.invoke("authorization-hold-actions",{body:{bookingId:input.bookingId,action:"release"}});
      if(error||data?.error)throw new Error(data?.error||error?.message||"Deposit release unavailable.");
      return data;
    }
    if(input.action==="status")throw new Error("No existing PayPal cancellation was found.");
    const {data,error}=await supabase.functions.invoke("cancellation-refund",{body:{bookingId:input.bookingId,cancelType:input.cancelType,reason:input.reason}});
    if(error||data?.error)throw new Error(data?.error||error?.message||"Cancellation unavailable.");
    return data;
  }
  const operationURL=new URL("/functions/v1/paypal-booking-operations",import.meta.env.VITE_SUPABASE_URL);
  const response=await fetch(operationURL,{method:"POST",headers,body:JSON.stringify({action:input.action||"cancel",paymentId:payments[0].id,...(input.action!=="status"?{reason:input.reason}:{})}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||"Cancellation is awaiting verified release/refund. Check the existing operation; do not start another payment.");
  return result;
}
