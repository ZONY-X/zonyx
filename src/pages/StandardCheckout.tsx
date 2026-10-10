import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { paypalAction, cancelRentalBooking } from "@/lib/payments";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";

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
  const [message,setMessage] = useState("Checking your existing checkout…");
  const paid = receipt?.state === "paid";
  const confirmed = receipt?.bookingConfirmed === true;

  async function refresh(id: string) {
    const rental = await paypalAction({action:"status",paymentId:id});
    setReceipt(rental);
    if (rental.bookingConfirmed) {
      setCanApprove(false); setMessage("Booking confirmed. Rental paid; deposit authorized, not charged."); return;
    }
    if (["cancelled","completed"].includes(rental.tripStatus || "")) {
      setCanApprove(false); setMessage(`Trip ${rental.tripStatus}. No further payment is required.`); return;
    }
    if (rental.state !== "paid") {
      setCanApprove(rental.state === "awaiting_approval");
      setMessage("Check this existing payment before continuing. Do not create another payment."); return;
    }
    if (["disabled","capability_verification_required","not_started"].includes(rental.depositStatus || "")) {
      setCanApprove(true); setMessage("Rental paid. Approve a separate deposit hold to confirm your reservation."); return;
    }
    const deposit = await paypalAction({action:"deposit-status",paymentId:id});
    if (deposit.bookingConfirmed) { setReceipt(deposit); setCanApprove(false); setMessage("Booking confirmed. Rental paid; deposit authorized, not charged."); return; }
    setCanApprove(deposit.operationState === "awaiting_approval");
    setMessage(deposit.operationState === "awaiting_approval"
      ? "Deposit approval is incomplete. Continue the same authorization or cancel and request a refund."
      : "The existing deposit needs reconciliation or does not cover this trip. No reservation is confirmed. Check its status or cancel and request a refund.");
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
        const existing = config.existingPayment;
        setEnabled(config.walletEnabled === true && config.depositEnabled === true && (!existing || existing.checkout_method === "paypal_wallet"));
        if (returning && (!existing || existing.id !== returnedPayment || existing.checkout_method !== "paypal_wallet")) throw new Error("Checkout identity conflicts. Contact support before paying again.");
        if (!existing) { setCanApprove(true); setMessage("Pay the rental, then separately approve your deposit hold. Both are required for confirmation."); return; }
        setPaymentId(existing.id);
        // URL tokens are never payment evidence. Each server operation validates
        // the owned, persisted order and uses a durable one-winner claim.
        if (returning && params.get("cancelled") !== "true") {
          if (params.get("phase") === "deposit") await paypalAction({action:"deposit-authorize",paymentId:existing.id});
          else if (existing.state !== "paid") await paypalAction({action:"capture",paymentId:existing.id});
        }
        await refresh(existing.id);
        if (existing.checkout_method !== "paypal_wallet") setCanApprove(false);
      } catch (error) {
        setCanApprove(false);
        setMessage(error instanceof Error ? error.message : "Checkout requires reconciliation. Do not pay again.");
      } finally { operation.current = false; setBusy(false); }
    })();
  }, [loading,user,bookingId,agreementId,returning,returnedPayment,params]);

  async function continueApproval() {
    if (operation.current || !canApprove || !enabled) return;
    operation.current = true; setBusy(true);
    try {
      const result = await paypalAction(paid ? {action:"deposit-create",paymentId} : {action:"create",method:"paypal_wallet",bookingId,agreementId});
      if (result.paymentId) setPaymentId(result.paymentId);
      if (result.bookingConfirmed && paymentId) { await refresh(paymentId); return; }
      if (paid && result.approvalReady && paymentId) {
        await paypalAction({action:"deposit-authorize",paymentId}); await refresh(paymentId); return;
      }
      approve(result.url);
    } catch (error) {
      setCanApprove(false);
      // Lost creation responses recover the persisted identity through config.
      try { const config = await paypalAction({action:"checkout-config",bookingId,agreementId}); if (config.existingPayment) setPaymentId(config.existingPayment.id); } catch { /* No financial retry. */ }
      setMessage(error instanceof Error ? error.message : "Unknown outcome. Check this existing checkout before continuing.");
    } finally { operation.current = false; setBusy(false); }
  }
  async function checkStatus() {
    if (!paymentId || operation.current) return;
    operation.current = true; setBusy(true);
    try { await refresh(paymentId); } catch { setCanApprove(false); setMessage("Status is unavailable. Contact support before paying again."); }
    finally { operation.current = false; setBusy(false); }
  }
  async function cancel() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setCanApprove(false);
    try {
      await cancelRentalBooking({bookingId,cancelType:"guest",reason:"Incomplete deposit approval; cancel unconfirmed reservation"});
      setMessage("Reservation cancelled and rental refund verified. No deposit was charged."); setReceipt(undefined);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cancellation requires reconciliation. Do not start another payment."); }
    finally { operation.current = false; setBusy(false); }
  }
  if (!loading && !user) return <Navigate to="/auth" replace />;
  return <MainLayout variant="app"><section className="container max-w-2xl pt-24 pb-20"><div className="rounded-3xl border bg-card p-8 space-y-5">
    <h1 className="text-2xl font-semibold">{confirmed ? "Booking confirmed" : paid ? "Approve your deposit hold" : "Pay for your rental"}</h1>
    {amount !== undefined && <p>Rental total: {money(amount)}</p>}
    {(receipt?.depositAmountCents ?? depositAmount) !== undefined && <p>Separate authorization hold: {money((receipt?.depositAmountCents ?? depositAmount)!)} — not charged.</p>}
    <p>You will approve the rental payment and deposit separately on PayPal. Card payment without a PayPal account is available only when PayPal offers it.</p>
    <p role="status" aria-live="polite">{message}</p>
    {!confirmed && <Button disabled={busy || !enabled || !canApprove} onClick={() => void continueApproval()}>{paid ? "Approve security deposit with PayPal" : "Continue to PayPal"}</Button>}
    {paymentId && <Button variant="outline" disabled={busy} onClick={() => void checkStatus()}>Check payment status</Button>}
    {paid && !confirmed && receipt?.tripStatus !== "cancelled" && <Button variant="outline" disabled={busy} onClick={() => void cancel()}>Cancel unconfirmed booking and request full rental refund</Button>}
    <Link className="block underline" to={`/booking/${encodeURIComponent(bookingId)}/agreement`}>Review your accepted agreement and price</Link>
  </div></section></MainLayout>;
}
