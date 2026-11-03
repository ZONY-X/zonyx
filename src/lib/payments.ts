import { supabase } from "@/integrations/supabase/client";
import { paypalAction } from "./payment-adapters/paypal";
import { squareAction } from "./payment-adapters/square";
export { paypalAction, squareAction };
export type PaymentProvider = "stripe" | "paypal" | "square" | "authorize_net" | (string & {});
export type RentalCheckoutInput = { bookingId: string; agreementId: string };
export type RentalCheckout = {
  provider: PaymentProvider;
  url: string;
  paymentId: string;
};
export const internalPayPalCheckoutEnabled = (tester: boolean) =>
  import.meta.env.VITE_PAYPAL_CUSTOMER_CHECKOUT_ENABLED === "true" || (tester && import.meta.env.VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED === "true");
// Adapter boundary: adding a provider never changes booking/agreement creation.
// The server selects new payments; historical actions retain their provider.
export async function startRentalCheckout(
  provider: PaymentProvider,
  input: RentalCheckoutInput,
): Promise<RentalCheckout> {
  // Re-resolve on entry: the booking may have acquired a payment since selection.
  const selected = await selectRentalCheckoutProvider(input.bookingId);
  if (selected !== provider) throw new Error("Checkout changed. Reload before continuing; no payment was started.");
  return { provider, url: `/booking/payment?${new URLSearchParams(input)}`, paymentId: input.bookingId };
}

export async function startPayPalWallet(input: RentalCheckoutInput) {
  const checkout = await paypalAction({
    action: "create",
    method: "paypal_wallet",
    ...input,
  });
  if (!checkout.url || !checkout.paymentId) {
    throw new Error("Secure checkout did not return an approval URL.");
  }
  const url = new URL(checkout.url);
  if (
    url.protocol !== "https:" ||
    !["www.paypal.com", "www.sandbox.paypal.com"].includes(url.hostname)
  ) throw new Error("Invalid payment approval URL.");
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
  if(payments[0]?.provider === "square") {
    if(input.action === "release") throw new Error("Square trip release is pending verification. Contact support.");
    return squareAction({action:input.action || "cancel",paymentId:payments[0].id,reason:input.reason},true);
  }
  if(payments[0] && !["stripe","paypal"].includes(payments[0].provider)) throw new Error("Unknown provider requires support.");
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

export async function selectRentalCheckoutProvider(bookingId: string, _tester?: boolean): Promise<PaymentProvider> {
  const { data, error } = await supabase.functions.invoke("payment-routing", { body: { bookingId } });
  if (error || !data?.provider) throw new Error("Secure checkout is unavailable. Check your existing payment or contact ZONYX.");
  return data.provider;
}

export async function savePayPalSetupToken(input: {
  setupToken: string;
  scope: "security_deposit" | "after_trip_charges";
  categories: string[];
  termsVersion: string;
  consentText: string;
  bookingId?: string;
}) {
  const { data, error } = await supabase.functions.invoke("paypal-vault", {
    body: { action: "store-setup-token", ...input },
  });
  if (error || data?.error) {
    throw new Error(
      data?.error || error?.message ||
        "PayPal payment method could not be saved.",
    );
  }
  return data;
}

export async function createPayPalSetupToken(input: {
  bookingId: string;
  agreementId: string;
}) {
  const { data, error } = await supabase.functions.invoke("paypal-vault", {
    body: { action: "create-setup-token", ...input },
  });
  if (error || !data?.vaultSetupToken) {
    throw new Error(error?.message || "PayPal secure card setup is unavailable.");
  }
  return data as { vaultSetupToken: string };
}
