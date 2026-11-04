import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { paypalAction, savePayPalSetupToken } from "@/lib/payments";
import { type CardSession, loadPayPalSdk } from "@/lib/paypal-sdk";
import StandardCheckout from "./StandardCheckout";
import { ZonyxPayHeader } from "@/components/rental/ZonyxPayHeader";

export default function PayPalCheckout() {
  const [params] = useSearchParams();
  return import.meta.env.VITE_PAYPAL_STANDARD_CHECKOUT_ENABLED === "true" ? <StandardCheckout /> : <CardCheckout key={`${params.get("bookingId")}:${params.get("agreementId")}`} />;
}
function CardCheckout() {
  const [params] = useSearchParams();
  const bookingId = params.get("bookingId") || "";
  const agreementId = params.get("agreementId") || "";
  const { user, loading: authLoading } = useAuth();
  const customerMode = import.meta.env.VITE_PAYPAL_CUSTOMER_CHECKOUT_ENABLED === "true";
  const enabled = customerMode || import.meta.env.VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED === "true";
  const { data: tester, isLoading: accessLoading } = useQuery({
    queryKey: ["paypal-card-checkout-access", user?.id, customerMode],
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
      return customerMode ? !!profile && profile.is_internal_tester !== true : profile?.is_internal_tester === true || profile?.is_admin === true;
    },
  });
  const number = useRef<HTMLDivElement>(null),
    expiry = useRef<HTMLDivElement>(null),
    cvv = useRef<HTMLDivElement>(null);
  const session = useRef<CardSession>();
  const operation = useRef(false);
  const [depositEnabled, setDepositEnabled] = useState(false);
  const [depositLater, setDepositLater] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paymentId, setPaymentId] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const [canSubmit, setCanSubmit] = useState(true);
  const [rentalPaid, setRentalPaid] = useState(false);
  const [depositAmount, setDepositAmount] = useState<number>();
  const [amount, setAmount] = useState<number>();
  const [paypalEnvironment, setPaypalEnvironment] = useState<"sandbox" | "live">("sandbox");
  const [postalCode, setPostalCode] = useState("");
  const [message, setMessage] = useState("Loading secure payment options…");
  useEffect(() => {
    if (!enabled || !tester || !bookingId || !agreementId) return;
    let disposed = false;
    const hosts = [number.current, expiry.current, cvv.current];
    setReady(false);

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
        setDepositAmount(config.depositAmountCents);
        setPaypalEnvironment(config.environment);
        setDepositEnabled(config.depositEnabled === true);
        setDepositLater(config.depositDeferred === true);

        if (!config.existingPayment && config.checkoutBlockReason) {
          setCanSubmit(false);
          const availableAt = config.checkoutAvailableAt
            ? ` Checkout opens ${new Date(config.checkoutAvailableAt).toLocaleString()}.`
            : "";
          setMessage(`${config.checkoutBlockReason}${availableAt}`);
          return;
        }

        if (config.existingPayment) {
          setPaymentId(config.existingPayment.id);
          setAttempted(true);
          if (config.existingPayment.state === "paid") {
            setRentalPaid(true);
            const receipt = await paypalAction({action:"status",paymentId:config.existingPayment.id});
            if (receipt.tripStatus === "cancelled" || receipt.tripStatus === "completed") { setCanSubmit(false); setMessage(`Trip ${receipt.tripStatus}. No new payment or authorization is required.`); return; }
            setConfirmed(receipt.bookingConfirmed === true);
            setCanSubmit(false);
            setMessage(receipt.depositScheduled
              ? "Booking confirmed. Rental paid; the refundable security-deposit authorization will be placed automatically closer to pickup."
              : receipt.bookingConfirmed ? "Booking confirmed. Rental paid; security deposit authorized." : "Rental paid. Security-deposit authorization is pending. Do not pay again.");
            return;
          } else if (
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
              : "Card processing is unavailable. Contact support; no alternative payment method is enabled.",
          );
          return;
        }
        const cardSession = sdk.createCardFieldsSavePaymentSession();
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
            "Secure card fields are unavailable. Contact support; no alternative payment method is enabled.",
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
  const showOutcome = (state?: string, bookingConfirmed = false, notificationStatus?: string, depositDueAt?: string) => {
    setRentalPaid(state === "paid");
    if (state === "paid" && depositDueAt && Date.parse(depositDueAt) > Date.now()) { setConfirmed(true); setCanSubmit(false); setMessage(`Reservation confirmed. Rental paid. Your refundable security deposit will be authorized automatically on ${new Date(depositDueAt).toLocaleString()}, before pickup. No deposit hold has been placed yet.`); return; }
    if (bookingConfirmed) { setConfirmed(true); setCanSubmit(false); setMessage("Booking confirmed. Rental paid; security deposit authorized, not charged." + (notificationStatus === "pending" ? " Your confirmation email is pending; your booking is confirmed." : "")); return; }
    if (state === "paid") { setCanSubmit(false); setMessage("Rental paid. Security-deposit authorization is pending; your reservation is not yet confirmed. Do not pay again."); return; }
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
  async function finishDeposit(rentalPaymentId: string, paymentSourceId: string, notificationStatus?: string) {
      const deposit = await paypalAction({
        action: "deposit-auto-authorize",
        paymentId: rentalPaymentId,
        paymentSourceId,
      });
      showOutcome("paid", deposit.bookingConfirmed, notificationStatus, deposit.authorizationDueAt);
  }
  async function payCard() {
    if (operation.current || !session.current || !ready || !canSubmit) return;
    operation.current = true;
    setBusy(true);
    setAttempted(true);
    let capturedRentalPaymentId: string | undefined;
    try {
      const setup = await createPayPalSetupToken({ bookingId, agreementId });
      if (!setup.vaultSetupToken) throw new Error("PayPal secure card setup is unavailable.");
      const saved = await session.current.submit(setup.vaultSetupToken, {
        billingAddress: { postalCode, countryCode: "US" },
      });
      if (saved.state !== "succeeded") throw new Error("PayPal card setup was not completed.");
      const stored = await savePayPalSetupToken({
        setupToken: setup.vaultSetupToken,
        scope: "after_trip_charges",
        categories: ["tolls", "excess_mileage", "late_return", "cleaning", "damage", "charging_energy", "parking_tickets_violations", "administrative_fee", "other"],
        termsVersion: "paypal-vault-v1",
        consentText: "I authorize ZONYX to save this PayPal payment method for this rental and to charge documented, contractually authorized expenses such as additional mileage, tolls, late returns, fuel or charging, and documented damages.",
        bookingId,
      });
      if (!stored.paymentMethod?.id) throw new Error("PayPal payment method could not be saved.");
      const created = await paypalAction({ action: "create", method: "card", bookingId, agreementId, paymentSourceId: stored.paymentMethod.id });
      const rentalPaymentId = created.paymentId;
      if (!created.orderId || !rentalPaymentId) throw new Error("Rental payment could not be prepared.");
      setPaymentId(rentalPaymentId);
      setCanSubmit(false);
      const captured = await paypalAction({ action: "capture", paymentId: rentalPaymentId });
      if (captured.state !== "paid") { showOutcome(captured.state); return; }
      capturedRentalPaymentId = rentalPaymentId;
      setRentalPaid(true);
      try {
        await finishDeposit(rentalPaymentId, stored.paymentMethod.id, captured.notificationStatus);
      } catch {
        const receipt = await paypalAction({ action: "status", paymentId: rentalPaymentId });
        if (receipt.state !== "paid") throw new Error("Rental capture requires reconciliation.");
        setConfirmed(false);
        setCanSubmit(false);
        setMessage("Rental payment confirmed. Security-deposit authorization is pending automatic processing; no second card entry is required.");
      }
    } catch (error) {
      if (capturedRentalPaymentId) {
        setCanSubmit(false);
        setMessage("Rental paid. Security deposit needs reconciliation. Your rental will not be charged again. Check payment status before continuing the deposit.");
        return;
      }
      // A create response can be lost after the durable reservation. Recover
      // its identity through a read-only config call so status remains usable.
      try {
        const config = await paypalAction({ action: "checkout-config", bookingId, agreementId });
        if (config.existingPayment) {
          setPaymentId(config.existingPayment.id);
          if (config.existingPayment.state === "paid") {
            setRentalPaid(true);
            setCanSubmit(false);
            setMessage("Rental paid. Security deposit needs reconciliation. Your rental will not be charged again. Check payment status before continuing the deposit.");
            return;
          }
        }
        else if (error instanceof Error && error.message.includes("These dates need a renewed security deposit")) {
          setCanSubmit(false);
          setMessage(error.message);
          return;
        }
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
      const receipt = await paypalAction({ action: "status", paymentId });
      if (receipt.tripStatus === "cancelled" || receipt.tripStatus === "completed") {
        setCanSubmit(false); setConfirmed(false); setRentalPaid(receipt.state === "paid");
        setMessage(`Trip ${receipt.tripStatus}. No new payment or authorization is required.`); return;
      }
      showOutcome(receipt.state, receipt.bookingConfirmed, receipt.notificationStatus, receipt.depositScheduled ? receipt.depositDueAt : undefined);
    } catch {
      setMessage(
        "Payment status is unavailable. Contact support before trying another payment.",
      );
    } finally {
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
            <ZonyxPayHeader bookingId={bookingId} title={confirmed ? "Booking confirmed" : "Pay for your rental"} description={customerMode ? "Complete your rental payment securely. Your refundable security deposit is managed automatically." : "Internal sandbox testing only. Booking confirmation requires a verified rental payment and security-deposit authorization."} />
            {amount !== undefined && (
              <p className="text-xl font-semibold mt-4">
                Rental total: {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(amount / 100)}
              </p>
            )}
            {depositAmount !== undefined && (
              <p className="text-sm mt-2">Refundable security deposit: {new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(depositAmount / 100)} authorization hold, not a charge.</p>
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
                <div className="space-y-4" hidden={rentalPaid}>
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
                  <p className="text-xs text-muted-foreground">
                    We may place an authorization hold for the refundable security deposit.
                  </p>
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
              </>
            )}
        </div>
      </section>
    </MainLayout>
  );
}
