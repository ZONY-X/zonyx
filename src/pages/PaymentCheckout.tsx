import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { paypalAction, startPayPalWallet } from "@/lib/payments";
import { type CardSession, loadPayPalSdk } from "@/lib/paypal-sdk";

export default function PaymentCheckout() {
  const [params] = useSearchParams();
  const bookingId = params.get("bookingId") || "";
  const agreementId = params.get("agreementId") || "";
  const { user, loading: authLoading } = useAuth();
  const enabled =
    import.meta.env.VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED === "true";
  const { data: tester, isLoading: accessLoading } = useQuery({
    queryKey: ["paypal-card-internal-access", user?.id],
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
  const number = useRef<HTMLDivElement>(null),
    expiry = useRef<HTMLDivElement>(null),
    cvv = useRef<HTMLDivElement>(null);
  const session = useRef<CardSession>();
  const operation = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paymentId, setPaymentId] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const [canSubmit, setCanSubmit] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [amount, setAmount] = useState<number>();
  const [postalCode, setPostalCode] = useState("");
  const [message, setMessage] = useState("Loading secure payment options…");
  useEffect(() => {
    if (!enabled || !tester || !bookingId || !agreementId) return;
    let disposed = false;
    const hosts = [number.current, expiry.current, cvv.current];
    setReady(false);
    setConfigured(false);
    setCanSubmit(false);
    session.current = undefined;
    void (async () => {
      try {
        const config = await paypalAction({
          action: "checkout-config",
          bookingId,
          agreementId,
        });
        if (disposed) return;
        setReady(false);
        setCanSubmit(true);
        setAttempted(false);
        setPaymentId(undefined);
        setAmount(config.amountCents);
        setConfigured(true);
        if (config.existingPayment) {
          setPaymentId(config.existingPayment.id);
          setAttempted(true);
          if (
            config.existingPayment.state !== "awaiting_approval" ||
            config.existingPayment.checkout_method !== "card"
          ) {
            setCanSubmit(false);
            setMessage(
              "An existing payment requires a status check. Do not start another payment.",
            );
            return;
          }
        }
        if (!config.cardEnabled || !config.environment) {
          setMessage(
            "Credit/debit card processing is not enabled for this internal test.",
          );
          return;
        }
        const token = await paypalAction({
          action: "client-token",
          bookingId,
          agreementId,
        });
        if (!token.clientToken || disposed) return;
        const namespace = await loadPayPalSdk(config.environment);
        const sdk = await namespace.createInstance({
          clientToken: token.clientToken,
          components: ["card-fields"],
          pageType: "checkout",
        });
        const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
        if (disposed) return;
        if (!methods.isEligible("advanced_cards")) {
          setMessage(
            config.existingPayment
              ? "Card processing is unavailable. Check this existing payment or contact support."
              : "Credit/debit cards are unavailable for this checkout. You may choose PayPal below.",
          );
          return;
        }
        const cardSession = sdk.createCardFieldsOneTimePaymentSession();
        const style = {
          input: {
            fontFamily: "DM Sans, sans-serif",
            fontSize: "16px",
            color: "#e5e7eb",
            background: "#050b09",
            padding: "12px",
            borderRadius: "12px",
            border: "0",
          },
        };
        for (
          const [host, type, placeholder] of [
            [number.current, "number", "Card number"],
            [expiry.current, "expiry", "MM/YY"],
            [cvv.current, "cvv", "Security code"],
          ] as const
        ) {
          const field = cardSession.createCardFieldsComponent({
            type,
            placeholder,
            style,
          });
          field.setAttribute("aria-label", placeholder);
          host?.replaceChildren(field);
        }
        session.current = cardSession;
        setReady(true);
        setMessage(
          "Your card details are securely handled by our payment processor.",
        );
      } catch {
        if (!disposed) {
          setMessage(
            "Secure card fields are unavailable. You may choose PayPal below.",
          );
        }
      }
    })();
    return () => {
      disposed = true;
      session.current = undefined;
      for (const host of hosts) host?.replaceChildren();
    };
  }, [enabled, tester, bookingId, agreementId]);
  const showOutcome = (state?: string) => {
    if (state === "awaiting_approval" && session.current) {
      setCanSubmit(true);
      setMessage("This card payment is awaiting approval. You can retry the same payment.");
      return;
    }
    setCanSubmit(false);
    setMessage(
      state === "paid"
        ? "Rental payment recorded. Security-deposit authorization is disabled for internal testing. This trip is not confirmed."
        : state === "cancelled"
        ? "Payment cancelled. No trip was confirmed."
        : "Payment outcome needs reconciliation. Check this existing payment; do not start another payment.",
    );
  };
  async function payCard() {
    if (operation.current || !session.current || !ready || !canSubmit) return;
    operation.current = true;
    setBusy(true);
    setAttempted(true);
    try {
      const created = await paypalAction({
        action: "create",
        method: "card",
        bookingId,
        agreementId,
      });
      if (!created.orderId || !created.paymentId) throw new Error();
      setPaymentId(created.paymentId);
      // Only hosted PayPal components receive card data. ZONYX passes billing
      // postal code directly to the SDK, never PAN/CVV to our server or logs.
      const result = await session.current.submit(created.orderId, {
        billingAddress: { postalCode, countryCode: "US" },
      });
      if (result.state === "canceled" || result.state === "failed") {
        setMessage(
          result.state === "canceled"
            ? "Card authentication was cancelled. No capture was requested. You can retry this same card payment."
            : "Card submission failed. No capture was requested. Check your card details and retry this same payment.",
        );
        return;
      }
      if (
        result.state !== "succeeded" || result.data?.orderId !== created.orderId
      ) throw new Error();
      // SDK success is not proof of funds. Server GET + amount/identity/3DS
      // validation and one-winner capture claim remain authoritative.
      setCanSubmit(false);
      const captured = await paypalAction({
        action: "capture",
        paymentId: created.paymentId,
      });
      showOutcome(captured.state);
    } catch {
      // A create response can be lost after the durable reservation. Recover
      // its identity through a read-only config call so status remains usable.
      try {
        const config = await paypalAction({ action: "checkout-config", bookingId, agreementId });
        if (config.existingPayment) setPaymentId(config.existingPayment.id);
      } catch { /* Support can still reconcile the booking server-side. */ }
      setCanSubmit(false);
      setMessage(
        "Payment outcome needs reconciliation. Check this existing payment or contact support; do not start another payment.",
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function checkStatus() {
    if (!paymentId || operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      showOutcome((await paypalAction({ action: "status", paymentId })).state);
    } catch {
      setMessage(
        "Payment status is unavailable. Contact support before trying another payment.",
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function payWallet() {
    if (!configured || attempted || operation.current) return;
    operation.current = true;
    setBusy(true);
    setAttempted(true);
    try {
      window.location.assign(
        (await startPayPalWallet({ bookingId, agreementId })).url,
      );
    } catch {
      try {
        const config = await paypalAction({ action: "checkout-config", bookingId, agreementId });
        if (config.existingPayment) setPaymentId(config.existingPayment.id);
      } catch { /* Do not retry order creation after an unknown outcome. */ }
      setCanSubmit(false);
      setMessage(
        "Payment outcome needs reconciliation. Check this existing payment or contact support before starting another payment.",
      );
      operation.current = false;
      setBusy(false);
    }
  }
  if (!enabled || (!authLoading && !accessLoading && !tester)) {
    return <Navigate to="/fleet" replace />;
  }
  return (
    <MainLayout variant="app">
      <section className="container max-w-2xl pt-24 pb-20">
        <div className="rounded-3xl border border-border bg-card p-6 md:p-8 space-y-6">
          <div>
            <p className="text-sm text-muted-foreground">
              ZONYX · Secure checkout
            </p>
            <h1 className="text-2xl font-semibold mt-2">Pay for your rental</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Internal testing only. Security-deposit authorization is disabled;
              payment will not confirm this trip.
            </p>
            {amount !== undefined && (
              <p className="text-xl font-semibold mt-4">
                Rental total: {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(amount / 100)}
              </p>
            )}
            {bookingId && (
              <Link
                className="inline-block text-sm underline mt-3"
                to={`/booking/${encodeURIComponent(bookingId)}/agreement`}
              >
                Review your accepted Rental Agreement and financial summary
              </Link>
            )}
          </div>
          {!bookingId || !agreementId
            ? (
              <p role="alert">
                Accepted booking and agreement references are required.
              </p>
            )
            : (
              <>
                <div className="space-y-4">
                  <h2 className="font-semibold">Credit / Debit Card</h2>
                  <div>
                    <p id="card-number-label" className="text-sm mb-2">
                      Card number
                    </p>
                    <div
                      ref={number}
                      aria-labelledby="card-number-label"
                      className="h-12 rounded-xl border bg-background"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p id="card-expiry-label" className="text-sm mb-2">
                        Expiration date
                      </p>
                      <div
                        ref={expiry}
                        aria-labelledby="card-expiry-label"
                        className="h-12 rounded-xl border bg-background"
                      />
                    </div>
                    <div>
                      <p id="card-cvv-label" className="text-sm mb-2">
                        Security code
                      </p>
                      <div
                        ref={cvv}
                        aria-labelledby="card-cvv-label"
                        className="h-12 rounded-xl border bg-background"
                      />
                    </div>
                  </div>
                  <label className="block text-sm" htmlFor="billing-postal">
                    Billing ZIP code (United States)
                  </label>
                  <Input
                    id="billing-postal"
                    autoComplete="billing postal-code"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    disabled={busy || !canSubmit}
                  />
                  <Button
                    className="w-full"
                    disabled={!ready || busy || !canSubmit ||
                      !/^\d{5}(-\d{4})?$/.test(postalCode)}
                    onClick={() => void payCard()}
                  >
                    {busy ? "Processing…" : "Pay ZONYX"}
                  </Button>
                </div>
                <p role="status" aria-live="polite" className="text-sm">
                  {message}
                </p>
                {paymentId && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void checkStatus()}
                  >
                    Check payment status
                  </Button>
                )}
                <div className="border-t pt-5">
                  <h2 className="text-sm text-muted-foreground mb-3">
                    Or pay with a wallet
                  </h2>
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={busy || attempted || !tester || !configured}
                    onClick={() => void payWallet()}
                  >
                    PayPal
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  By paying with your card, you acknowledge that PayPal
                  processes your payment data under its{" "}
                  <a
                    className="underline"
                    href="https://www.paypal.com/us/legalhub/paypal/privacy-full"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    PayPal Privacy Statement
                  </a>. ZONYX does not receive your full card number or security
                  code.
                </p>
              </>
            )}
        </div>
      </section>
    </MainLayout>
  );
}
