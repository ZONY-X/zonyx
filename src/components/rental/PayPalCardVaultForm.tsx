import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { paypalAction, savePayPalSetupToken } from "@/lib/payments";
import { type CardSession, loadPayPalSdk } from "@/lib/paypal-sdk";
import { PayPalPaymentConsent } from "./PayPalPaymentConsent";

type Props = {
  environment: "sandbox" | "live";
  bookingId: string;
  agreementId: string;
};
type SavedMethod = {
  id: string;
  status: "active" | "revoked" | "expired" | "failed";
  environment: string;
  created_at: string;
};

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

export function PayPalCardVaultForm({ environment, bookingId, agreementId }: Props) {
  const { user } = useAuth();
  const number = useRef<HTMLDivElement>(null);
  const expiry = useRef<HTMLDivElement>(null);
  const cvv = useRef<HTMLDivElement>(null);
  const session = useRef<CardSession>();
  const [consent, setConsent] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [methods, setMethods] = useState<SavedMethod[]>([]);

  const refreshMethods = async () => {
    const { data, error } = await supabase.functions.invoke("paypal-vault", {
      body: { action: "list" },
    });
    if (!error && Array.isArray(data?.paymentMethods)) {
      setMethods(data.paymentMethods);
    }
  };

  useEffect(() => {
    if (!user || import.meta.env.VITE_PAYPAL_VAULT_ENABLED !== "true") return;
    let disposed = false;
    void (async () => {
      try {
        const token = await paypalAction({
          action: "client-token",
          bookingId,
          agreementId,
        });
        if (!token.clientToken) throw new Error("Card initialization is unavailable.");
        const namespace = await loadPayPalSdk(environment);
        const sdk = await namespace.createInstance({
          clientToken: token.clientToken,
          components: ["card-fields"],
          pageType: "checkout",
        });
        const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
        if (!methods.isEligible("advanced_cards")) throw new Error("PayPal card vaulting is unavailable.");
        const saveSession = sdk.createCardFieldsSavePaymentSession();
        for (const [host, type, placeholder] of [
          [number.current, "number", "Card number"],
          [expiry.current, "expiry", "MM/YY"],
          [cvv.current, "cvv", "Security code"],
        ] as const) {
          const field = saveSession.createCardFieldsComponent({ type, placeholder, style });
          field.setAttribute("aria-label", placeholder);
          host?.replaceChildren(field);
        }
        if (!disposed) {
          session.current = saveSession;
          setReady(true);
          await refreshMethods();
        }
      } catch {
        if (!disposed) setMessage("Saved PayPal payment methods are unavailable.");
      }
    })();
    return () => {
      disposed = true;
      session.current = undefined;
      number.current?.replaceChildren();
      expiry.current?.replaceChildren();
      cvv.current?.replaceChildren();
    };
  }, [agreementId, bookingId, environment, user]);

  if (import.meta.env.VITE_PAYPAL_VAULT_ENABLED !== "true") return null;

  const revoke = async (id: string) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("paypal-vault", {
      body: { action: "revoke", paymentSourceId: id },
    });
    setBusy(false);
    if (error || data?.error) {
      setMessage(data?.error || error?.message || "Payment method revocation failed.");
      return;
    }
    setMessage("Saved PayPal payment method revoked.");
    await refreshMethods();
  };

  const save = async () => {
    if (!session.current || !ready || !consent || busy) {
      setMessage("Complete the hosted card fields and consent before saving.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("paypal-vault", {
        body: { action: "create-setup-token", bookingId },
      });
      if (error || !data?.vaultSetupToken) throw new Error(error?.message || "PayPal setup token creation failed.");
      const result = await session.current.submit(data.vaultSetupToken);
      if (result.state !== "succeeded") {
        throw new Error(result.state === "canceled" ? "Card save was canceled." : "PayPal card setup was declined.");
      }
      await savePayPalSetupToken({
        setupToken: data.vaultSetupToken,
        scope: "after_trip_charges",
        categories: ["tolls", "charging_energy", "excess_mileage", "damage"],
        termsVersion: "paypal-vault-v1",
        consentText: "Save this PayPal payment method for this rental's security deposit and documented after-trip charges.",
        bookingId,
      });
      setMessage("PayPal payment method saved securely.");
      setConsent(false);
      await refreshMethods();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PayPal card setup failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-dashed p-4">
      <div>
        <h3 className="font-semibold">Save a PayPal payment method</h3>
        <p className="text-sm text-muted-foreground">
          This is a separate hosted card session. It does not replace or alter your rental payment.
        </p>
      </div>
      <div className="space-y-3">
        <div ref={number} className="h-12 rounded-xl border bg-background" />
        <div className="grid grid-cols-2 gap-3">
          <div ref={expiry} className="h-12 rounded-xl border bg-background" />
          <div ref={cvv} className="h-12 rounded-xl border bg-background" />
        </div>
      </div>
      <PayPalPaymentConsent checked={consent} onCheckedChange={setConsent} />
      <Button type="button" disabled={!ready || busy || !consent} onClick={() => void save()}>
        {busy ? "Saving securely…" : "Save payment method"}
      </Button>
      {methods.filter((method) => method.status === "active").map((method) => (
        <div key={method.id} className="flex items-center justify-between border-t pt-2 text-sm">
          <span>PayPal {method.environment} · added {new Date(method.created_at).toLocaleDateString()}</span>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void revoke(method.id)}>
            Revoke
          </Button>
        </div>
      ))}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
