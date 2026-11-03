import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { paypalAction, cancelRentalBooking } from "@/lib/payments";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { ZonyxPayHeader } from "@/components/rental/ZonyxPayHeader";

// PayPal stays inert until merchant enablement is complete.
const PAYPAL_LIVE_ACTION_ENABLED = import.meta.env.VITE_PAYPAL_LIVE_ACTION_ENABLED === "true";

type Outcome = Awaited<ReturnType<typeof paypalAction>>;
const money = (amount: number) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(amount / 100);
function approve(url?: string) {
  if (!url) throw new Error("Approval is unavailable. Check the existing payment.");
  const target = new URL(url);
  if (target.protocol !== "https:" || !["www.paypal.com","www.sandbox.paypal.com"].includes(target.hostname)) throw new Error("Invalid payment approval destination.");
  window.location.assign(target.href);
}

// Redirect-based Standard needs no card fields, token, vault or second SDK.
export default function StandardCheckout({ returning = false }: {returning?: boolean}) {
  const [params] = useSearchParams();
  const bookingId = params.get("bookingId") || "", agreementId = params.get("agreementId") || "";
  const returnedPayment = params.get("payment_id");
  const {user,loading} = useAuth();
  const started = useRef(false), operation = useRef(false);
  const [busy,setBusy] = useState(true), [enabled,setEnabled] = useState(false);
  const [paymentId,setPaymentId] = useState<string>();
  const [amount,setAmount] = useState<number>(), [receipt,setReceipt] = useState<Outcome>();
  const [depositAmount,setDepositAmount] = useState<number>();
  const [canApprove,setCanApprove] = useState(false);
  const [availableAt,setAvailableAt] = useState<string>();
  const [depositDeferred,setDepositDeferred] = useState(false);
  const [depositDueAt,setDepositDueAt] = useState<string>();
  const [checkoutBlocked,setCheckoutBlocked] = useState(false);
  const [message,setMessage] = useState("");
  const paid = receipt?.state === "paid";
  const confirmed = receipt?.bookingConfirmed === true;

  async function refresh(id: string) {
    const rental = await paypalAction({action:"status",paymentId:id});
    setReceipt(rental);
    if (rental.bookingConfirmed) {
      setCanApprove(false); setMessage(""); return;
    }
    if (["cancelled","completed"].includes(rental.tripStatus || "")) {
      setCanApprove(false); setMessage("No further payment is required for this reservation."); return;
    }
    if (rental.state !== "paid") {
      setCanApprove(rental.state === "awaiting_approval");
      setMessage("We are confirming your payment. Please check its status before trying again."); return;
    }
    setCanApprove(false);
    setMessage(rental.depositDueAt
      ? "Your rental is paid. The refundable security-deposit authorization will be placed automatically closer to pickup."
      : "Your rental is paid. The refundable security-deposit authorization is managed automatically.");
  }

  useEffect(() => {
    if (loading || !user || started.current || !bookingId || !agreementId) return;
    started.current = true;
    operation.current = true;
    void (async () => {
      try {
        const config = await paypalAction({action:"checkout-config",bookingId,agreementId});
        setAmount(config.amountCents);
        setDepositAmount(config.depositAmountCents);
        setDepositDeferred(config.depositDeferred === true);
        setDepositDueAt(config.depositDueAt);
        const existing = config.existingPayment;
        setEnabled(config.walletEnabled === true && config.depositEnabled === true && (!existing || existing.checkout_method === "paypal_wallet"));
        if (!existing && config.checkoutBlockReason) {
          setCanApprove(false); setCheckoutBlocked(true); setAvailableAt(config.checkoutAvailableAt); setMessage("Online payment is not available for these dates. Please contact support."); return;
        }
        if (returning && (!existing || existing.id !== returnedPayment || existing.checkout_method !== "paypal_wallet")) throw new Error("Checkout identity conflicts. Contact support before paying again.");
        if (!existing) {
          setCanApprove(true);
          setMessage(config.depositDeferred
            ? "Your rental can be paid now. The security deposit will be requested closer to pickup."
            : "");
          return;
        }
        setPaymentId(existing.id);
        // URL tokens are never payment evidence. Each server operation validates
        // the owned, persisted order and uses a durable one-winner claim.
        if (returning && params.get("cancelled") !== "true") {
          if (existing.state !== "paid") await paypalAction({action:"capture",paymentId:existing.id});
        }
        await refresh(existing.id);
        if (existing.checkout_method !== "paypal_wallet") setCanApprove(false);
      } catch (error) {
        setCanApprove(false);
        setMessage("We could not load your checkout. Please refresh or contact support.");
      } finally { operation.current = false; setBusy(false); }
    })();
  }, [loading,user,bookingId,agreementId,returning,returnedPayment,params]);

  async function continueApproval() {
    if (operation.current || !canApprove || !enabled) return;
    operation.current = true; setBusy(true);
    try {
      if (paid) {
        await refresh(paymentId!);
        return;
      }
      const result = await paypalAction({action:"create",method:"paypal_wallet",bookingId,agreementId});
      if (result.paymentId) setPaymentId(result.paymentId);
      if (result.bookingConfirmed && paymentId) { await refresh(paymentId); return; }
      approve(result.url);
    } catch (error) {
      setCanApprove(false);
      // Lost creation responses recover the persisted identity through config.
      try { const config = await paypalAction({action:"checkout-config",bookingId,agreementId}); if (config.existingPayment) setPaymentId(config.existingPayment.id); } catch { /* No financial retry. */ }
      setMessage("We could not confirm your payment. Please check its status before trying again.");
    } finally { operation.current = false; setBusy(false); }
  }
  async function checkStatus() {
    if (!paymentId || operation.current) return;
    operation.current = true; setBusy(true);
    try { await refresh(paymentId); } catch { setCanApprove(false); setMessage("Status is unavailable. Please contact support before paying again."); }
    finally { operation.current = false; setBusy(false); }
  }
  async function cancel() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setCanApprove(false);
    try {
      await cancelRentalBooking({bookingId,cancelType:"guest",reason:"Incomplete rental payment; cancel unconfirmed reservation"});
      setMessage("Your reservation was cancelled and your rental refunded."); setReceipt(undefined);
    } catch (error) { setMessage("We could not complete the cancellation. Please contact support."); }
    finally { operation.current = false; setBusy(false); }
  }
  if (!loading && !user) return <Navigate to="/auth" replace />;
  const depositCents = receipt?.depositAmountCents ?? depositAmount;
  const goldButton = "h-12 w-full rounded-xl bg-[#0fd8c4] text-black shadow-none transition-colors hover:bg-[#2fe6d3] focus-visible:ring-2 focus-visible:ring-[#0fd8c4] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:bg-[#0fd8c4] disabled:opacity-60";
  if (confirmed) return <MainLayout variant="booking"><main className="min-h-screen bg-black px-4 pb-28 pt-28 sm:pb-20 sm:pt-32"><div role="status" className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-black p-6 text-center sm:p-8"><ZonyxPayHeader title="" />
    <span aria-hidden="true" className="mx-auto mt-2 flex h-14 w-14 items-center justify-center rounded-full border border-[#0fd8c4]/40 text-2xl text-[#0fd8c4]">✓</span>
    <h2 className="mt-5 text-2xl font-semibold text-white">Booking Confirmed</h2>
    <p className="mt-2 text-neutral-400">Your reservation is confirmed.</p>
    <p className="mt-6 break-all text-sm text-neutral-500">Booking reference: <span className="text-neutral-300">{bookingId}</span></p>
  </div></main></MainLayout>;
  return <MainLayout variant="booking"><main className="min-h-screen bg-black px-4 pb-28 pt-28 sm:pb-20 sm:pt-32"><div className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-black p-6 sm:p-8">
    <ZonyxPayHeader title="Complete Your Reservation" />
    <dl className="mt-6 space-y-3 text-sm">
      {amount !== undefined && <div className="flex items-baseline justify-between gap-4"><dt className="text-neutral-400">Rental Total</dt><dd className="text-base font-semibold text-white">{money(amount)}</dd></div>}
      {depositCents !== undefined && <div className="flex items-baseline justify-between gap-4"><dt className="text-neutral-400">Refundable Security Deposit</dt><dd className="text-base font-semibold text-white">{money(depositCents)}</dd></div>}
    </dl>
    {message && <p role="status" aria-live="polite" className="mt-6 rounded-xl border border-white/10 px-4 py-3 text-sm text-neutral-300">{message}</p>}
    {!checkoutBlocked && <Button aria-label="Continue to secure payment" disabled={busy || !PAYPAL_LIVE_ACTION_ENABLED || !enabled || !canApprove} onClick={() => void continueApproval()} className={`mt-6 ${goldButton}`}>Continue to secure payment</Button>}
    {!PAYPAL_LIVE_ACTION_ENABLED && <p className="mt-3 text-center text-xs text-neutral-500">Secure payment is awaiting activation.</p>}
    <p className="mt-4 text-center text-sm text-neutral-400">{depositDeferred ? `The refundable security deposit will be requested closer to pickup${depositDueAt ? `, beginning ${new Date(depositDueAt).toLocaleString()}` : ""}.` : "A refundable security deposit may be temporarily authorized on your card."}</p>
    {paymentId && <Button variant="outline" disabled={busy} onClick={() => void checkStatus()} className="mt-5 h-11 w-full rounded-xl border-white/15 bg-transparent text-neutral-200 hover:bg-white/5 hover:text-white">Check payment status</Button>}
    {paid && !confirmed && receipt?.tripStatus !== "cancelled" && <Button variant="ghost" disabled={busy} onClick={() => void cancel()} className="mt-2 w-full text-neutral-500 hover:bg-transparent hover:text-white">Cancel and request a refund</Button>}
  </div></main></MainLayout>;
}
