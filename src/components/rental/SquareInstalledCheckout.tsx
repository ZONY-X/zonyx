import { useEffect, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { ZonyxPayHeader } from "@/components/rental/ZonyxPayHeader";
import { supabase } from "@/integrations/supabase/client";

// Installation deliberately has no tokenize, authorize, charge or capture action.
export function SquareInstalledCheckout() {
  const host = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("Loading secure card form…");
  useEffect(() => {
    let disposed = false;
    let card: { attach(element: HTMLElement): Promise<void>; destroy(): Promise<void> } | undefined;
    const script = document.createElement("script");
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("square-public-config", { method: "GET" });
        if (error || !data?.applicationId || !data?.locationId || data.environment !== "live" || data.paymentsEnabled !== false) throw new Error("The secure card form is temporarily unavailable. Please contact ZONYX.");
        if (disposed) return;
        script.src = "https://web.squarecdn.com/v1/square.js";
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("The secure card form could not load. Please try again later."));
          document.head.appendChild(script);
        });
        const sdk = (window as Window & { Square?: { payments(app: string, location: string): { card(): Promise<NonNullable<typeof card>> } } }).Square;
        if (!sdk) throw new Error("The secure card form is temporarily unavailable.");
        card = await sdk.payments(data.applicationId, data.locationId).card();
        if (disposed) { await card.destroy(); return; }
        if (!host.current) throw new Error("The secure card form is temporarily unavailable.");
        await card.attach(host.current);
        if (!disposed) setMessage("Card payments are not open yet. No payment or deposit authorization can be submitted.");
      } catch (error) {
        if (!disposed) setMessage(error instanceof Error ? error.message : "The secure card form is temporarily unavailable.");
      }
    })();
    return () => { disposed = true; if (card) void card.destroy(); script.remove(); };
  }, []);
  return <MainLayout variant="booking"><div className="container max-w-xl pb-16 pt-36">
    <ZonyxPayHeader title="Secure card payment" description="Your ZONYX checkout. Card details are securely handled by Square." />
    <p role="status" className="my-6">{message}</p>
    <div ref={host} />
    <div className="mt-6 flex flex-wrap gap-3">
      <Button disabled>Card payments opening soon</Button>
      <Button variant="outline" disabled>PayPal · alternative</Button>
    </div>
    <p className="mt-6 text-sm text-muted-foreground">Security deposits are temporary authorizations, not automatic charges. Square authorizations last up to seven days. Reservations needing longer coverage require a separate deposit procedure approved before payment.</p>
  </div></MainLayout>;
}
