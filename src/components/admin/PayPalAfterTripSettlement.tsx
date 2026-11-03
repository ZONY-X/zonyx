import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  bookingId: string;
  chargeId: string;
  amountCents: number;
};
type PaymentMethod = { id: string; status: string; environment: string };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function PayPalAfterTripSettlement({ bookingId, chargeId, amountCents }: Props) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState(String(amountCents));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (import.meta.env.VITE_PAYPAL_MIT_ENABLED !== "true") return;
    void supabase.functions.invoke("paypal-vault", {
      body: { action: "list-for-booking", bookingId },
    }).then(({ data, error }) => {
      if (error || !Array.isArray(data?.paymentMethods)) {
        setMessage("PayPal saved payment methods are unavailable.");
        return;
      }
      setMethods(data.paymentMethods.filter((method: PaymentMethod) => method.status === "active"));
    });
  }, [bookingId]);

  if (import.meta.env.VITE_PAYPAL_MIT_ENABLED !== "true") return null;

  const charge = async () => {
    const cents = Number(amount);
    if (!selected || !Number.isInteger(cents) || cents <= 0 || cents > amountCents) {
      setMessage(`Enter a whole-cent amount up to ${money(amountCents)}.`);
      return;
    }
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke("paypal-mit", {
      body: { action: "charge-after-trip", chargeId, paymentSourceId: selected },
    });
    setBusy(false);
    if (error || data?.error) {
      setMessage(data?.error || error?.message || "PayPal charge requires reconciliation.");
      return;
    }
    setMessage("PayPal merchant-initiated charge completed and recorded.");
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-dashed p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        PayPal merchant-initiated charge
      </p>
      {methods.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active consented PayPal payment method is available.</p>
      ) : (
        <>
          <select
            className="w-full rounded-md border bg-background p-2 text-sm"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            aria-label="PayPal saved payment method"
          >
            <option value="">Select a consented payment method</option>
            {methods.map((method) => (
              <option key={method.id} value={method.id}>
                PayPal {method.environment} · {method.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" aria-label="Charge amount in cents" />
            <Button type="button" disabled={busy} onClick={() => void charge()}>
              {busy ? "Charging…" : "Charge"}
            </Button>
          </div>
        </>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
