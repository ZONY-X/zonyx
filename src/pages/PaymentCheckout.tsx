import { lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { selectRentalCheckoutProvider } from "@/lib/payments";
import { MainLayout } from "@/components/layout/MainLayout";
import { ZonyxPayHeader } from "@/components/rental/ZonyxPayHeader";
import { rentalCheckoutAdapters } from "@/lib/payment-adapters/registry";

// Component types are stable across renders; only the selected adapter loads its SDK.
const adapters = {
  square: lazy(rentalCheckoutAdapters.square.load),
  paypal: lazy(rentalCheckoutAdapters.paypal.load),
};
export default function PaymentCheckout() {
  const [params] = useSearchParams();
  const bookingId = params.get("bookingId") || "";
  const agreementId = params.get("agreementId") || "";
  const { user, loading } = useAuth();
  const route = useQuery({
    queryKey: ["payment-routing", user?.id, bookingId],
    queryFn: () => selectRentalCheckoutProvider(bookingId),
    enabled: !!user && !!bookingId && !!agreementId,
    retry: false,
    // Do not remount a payment adapter on focus or reconnect during submission.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const Adapter = route.data === "square" || route.data === "paypal" ? adapters[route.data] : null;
  if (Adapter) return <Suspense fallback={<p role="status">Loading secure checkout…</p>}><Adapter /></Suspense>;
  return <MainLayout variant="booking"><main className="container max-w-xl pb-20 pt-36">
    <ZonyxPayHeader title="Secure payment" />
    <p role="status" className="mt-6">{loading ? "Loading secure checkout…" : !bookingId || !agreementId ? "Choose a vehicle and complete your rental agreement to continue." : !user ? "Sign in to continue with your reservation." : route.error ? route.error.message : route.data ? "Secure checkout is unavailable. Contact ZONYX before trying another payment." : "Loading secure checkout…"}</p>
    {!loading && !user && <Link className="underline" to={`/auth?redirectTo=${encodeURIComponent(`/booking/payment?${params}`)}`}>Sign in to continue</Link>}
    {(!bookingId || !agreementId) && <Link className="underline" to="/fleet">Choose your Tesla</Link>}
  </main></MainLayout>;
}
