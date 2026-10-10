import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { paypalAction } from "@/lib/payments";
import StandardCheckout from "./StandardCheckout";

export default function PayPalReturn() {
  return import.meta.env.VITE_PAYPAL_STANDARD_CHECKOUT_ENABLED === "true" ? <StandardCheckout returning /> : <InternalPayPalReturn />;
}
function InternalPayPalReturn() {
  const [params] = useSearchParams();
  const paymentId = params.get("payment_id");
  const cancelled = params.get("cancelled") === "true";
  const [message, setMessage] = useState(
    "Checking your existing rental payment…",
  );
  const [loading, setLoading] = useState(true);
  const started = useRef(false);
  const { user, loading: authLoading } = useAuth();
  const enabled =
    import.meta.env.VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED === "true";
  const { data: tester, isLoading: accessLoading } = useQuery({
    queryKey: ["paypal-return-internal-access", user?.id],
    enabled: enabled && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq(
        "user_id",
        user!.id,
      ).maybeSingle();
      if (error) throw new Error("Internal test access is unavailable.");
      const profile = data as unknown as {
        is_internal_tester?: boolean;
        is_admin?: boolean;
      } | null;
      return profile?.is_internal_tester === true || profile?.is_admin === true;
    },
  });
  const reconcile = useCallback(
    async (action: "capture" | "cancel" | "status") => {
      setLoading(true);
      try {
        if (!paymentId) throw new Error("Payment reference is missing.");
        // Query-string approval tokens are not payment evidence. Only the backend
        // can validate the persisted order and record a completed capture.
        const result = await paypalAction({ action, paymentId });
        setMessage(
          result.bookingConfirmed
            ? "Booking confirmed. Rental paid; security deposit authorized, not charged."
            : result.state === "paid"
            ? "Rental payment recorded. Separate security-deposit authorization is required. This trip is not confirmed."
            : result.state === "cancelled"
            ? "Checkout was cancelled. No trip was confirmed."
            : "The payment is not confirmed. Check this existing payment again or contact support; do not create another payment.",
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Payment outcome requires reconciliation.",
        );
      } finally {
        setLoading(false);
      }
    },
    [paymentId],
  );
  useEffect(() => {
    if (
      !enabled || !tester || authLoading || accessLoading || started.current
    ) return;
    started.current = true;
    void reconcile(cancelled ? "cancel" : "capture");
  }, [enabled, tester, authLoading, accessLoading, cancelled, reconcile]);
  if (!enabled || (!authLoading && !accessLoading && !tester)) {
    return <Navigate to="/fleet" replace />;
  }
  if (authLoading || accessLoading) {
    return (
      <MainLayout variant="app">
        <p className="container pt-24" role="status">
          Checking internal test access…
        </p>
      </MainLayout>
    );
  }
  return (
    <MainLayout variant="app">
      <section className="container max-w-3xl pt-24 pb-20">
        <div className="rounded-3xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold">Internal PayPal checkout</h1>
          <p className="mt-4" role="status">{message}</p>
          <div className="mt-6 flex gap-3">
            <Button
              disabled={loading || !paymentId}
              onClick={() => void reconcile("status")}
            >
              Check payment status
            </Button>
            <Button asChild variant="outline">
              <Link to="/dashboard">View bookings</Link>
            </Button>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}
