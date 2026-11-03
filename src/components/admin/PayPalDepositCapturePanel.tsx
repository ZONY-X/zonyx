import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

type Props = { bookingId: string };
type Deposit = {
  id: string;
  status: string;
  amount_cents: number;
  captured_amount_cents: number;
  currency: string;
  expires_at: string | null;
  provider_authorization_id: string | null;
};
type Charge = {
  id: string;
  category: string;
  amount_cents: number;
  payment_status: string;
  status: string;
};
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function PayPalDepositCapturePanel({ bookingId }: Props) {
  const [selectedCharge, setSelectedCharge] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["paypal-deposit-capture", bookingId],
    queryFn: async () => {
      const [depositResult, chargesResult] = await Promise.all([
        supabase.from("booking_security_deposits").select(
          "id,status,amount_cents,captured_amount_cents,currency,expires_at,provider_authorization_id",
        ).eq("booking_id", bookingId).order("generation", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("after_trip_charges").select(
          "id,category,amount_cents,payment_status,status",
        ).eq("booking_id", bookingId).in("status", ["submitted", "pending_payment"]),
      ]);
      if (depositResult.error) throw depositResult.error;
      if (chargesResult.error) throw chargesResult.error;
      return {
        deposit: depositResult.data as Deposit | null,
        charges: (chargesResult.data ?? []) as Charge[],
      };
    },
    enabled: import.meta.env.VITE_PAYPAL_MIT_ENABLED === "true",
  });
  if (import.meta.env.VITE_PAYPAL_MIT_ENABLED !== "true" || query.isLoading) return null;
  if (query.error) return <p className="text-xs text-amber-600">PayPal deposit details are unavailable.</p>;
  const deposit = query.data?.deposit;
  if (!deposit || !["authorized", "partially_captured"].includes(deposit.status) || !deposit.provider_authorization_id) {
    return null;
  }
  const remaining = deposit.amount_cents - deposit.captured_amount_cents;
  if (remaining <= 0) return null;
  const selected = query.data?.charges.find((charge) => charge.id === selectedCharge);

  const capture = async () => {
    const cents = Number(amount);
    if (!selected || !Number.isInteger(cents) || cents !== selected.amount_cents || cents > remaining) {
      setMessage(`Select one unpaid charge and enter exactly ${money(selected?.amount_cents ?? 0)}.`);
      return;
    }
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke("paypal-mit", {
      body: {
        action: "capture-deposit",
        depositId: deposit.id,
        chargeId: selected.id,
        amountCents: cents,
      },
    });
    setBusy(false);
    if (error || data?.error) {
      setMessage(data?.error || error?.message || "Deposit capture requires reconciliation.");
      return;
    }
    setMessage(data?.operation?.state === "succeeded" ? "Deposit capture completed and ledger entry recorded." : "Deposit capture is pending reconciliation.");
    setSelectedCharge("");
    setAmount("");
    await query.refetch();
  };

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-amber-500/50 p-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-amber-600">PayPal security deposit</p>
        <p className="text-sm">
          Authorized {money(deposit.amount_cents)} · Captured {money(deposit.captured_amount_cents)} · Remaining {money(remaining)}
        </p>
        <p className="text-xs text-muted-foreground">
          Expires {deposit.expires_at ? new Date(deposit.expires_at).toLocaleString() : "unknown"} · {deposit.status}
        </p>
      </div>
      {query.data?.charges.length ? (
        <>
          <select
            className="w-full rounded-md border bg-background p-2 text-sm"
            value={selectedCharge}
            onChange={(event) => {
              const charge = query.data?.charges.find((item) => item.id === event.target.value);
              setSelectedCharge(event.target.value);
              setAmount(charge ? String(charge.amount_cents) : "");
            }}
            aria-label="After-trip charge for deposit capture"
          >
            <option value="">Select eligible after-trip charge</option>
            {query.data.charges.filter((charge) => charge.payment_status !== "paid").map((charge) => (
              <option key={charge.id} value={charge.id}>
                {charge.category} · {money(charge.amount_cents)}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" aria-label="Deposit capture amount in cents" />
            <Button type="button" disabled={busy} onClick={() => void capture()}>
              {busy ? "Capturing…" : "Capture deposit"}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No eligible unpaid after-trip charges.</p>
      )}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
