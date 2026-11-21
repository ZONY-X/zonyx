import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// Read-only observer outside the payment components. Confirmation and invitation
// delivery never depend on this component or a successful browser return.
export function GuestAccountNotice() {
  const location = useLocation();
  const { user } = useAuth();
  const bookingId = new URLSearchParams(location.search).get("bookingId");
  const eligible = user?.is_anonymous && ["/booking/payment", "/booking/paypal/return", "/booking/square", "/booking/confirmed", "/booking/success"].includes(location.pathname);
  const [status, setStatus] = useState<{ id: string; userId: string; sent: boolean }>();
  useEffect(() => {
    setStatus(undefined);
    if (!eligible || !bookingId) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const check = async () => {
      let sent = false;
      try {
        const { data, error } = await supabase.functions.invoke("guest-account", { body: { action: "status", bookingId } });
        if (disposed) return;
        sent = !error && data?.invitationSent === true;
        if (!error && data?.confirmed === true) setStatus({ id: bookingId, userId: user.id, sent });
      } catch { /* Retry account status independently of payment. */ }
      if (!disposed && ++attempts < 120 && !sent) timer = setTimeout(() => { void check(); }, 5000);
    };
    void check().catch(() => { /* Account/email availability never affects checkout. */ });
    return () => { disposed = true; clearTimeout(timer); };
  }, [eligible, bookingId, user?.id]);
  if (!eligible || status?.id !== bookingId || status?.userId !== user?.id) return null;
  return <aside role="status" className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-md rounded-2xl border border-border bg-card p-4 text-sm shadow-lg">
    <p>{status.sent ? "Your secure account access email has been sent." : "Your booking is confirmed. We’ll email your secure account access link."}</p>
    <p className="mt-2 text-muted-foreground">Email delays do not affect your reservation. Complete identity and license verification before handover.</p>
    <Link to="/booking/access" className="mt-2 inline-block text-primary underline">Account access</Link>
  </aside>;
}
