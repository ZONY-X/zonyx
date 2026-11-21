import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type Booking = { id: string; reference: string; vehicle: string; startDate: string; endDate: string; tripStatus: string; totalCents: number; currency: string };
export default function GuestAccountAccess() {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const verified = !!user?.email_confirmed_at && !user?.is_anonymous;
  const [bookings, setBookings] = useState<{ userId: string; rows: Booking[] }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBookings(undefined);
    if (!verified) return;
    let disposed = false;
    void supabase.functions.invoke("guest-account", { body: { action: "bookings" } }).then(({ data, error }) => {
      if (disposed) return;
      if (error || !Array.isArray(data?.bookings)) setMessage("Reservations are temporarily unavailable. Please try again or contact support.");
      else setBookings({ userId: userId!, rows: data.bookings });
    }).catch(() => { if (!disposed) setMessage("Reservations are temporarily unavailable. Please try again."); });
    return () => { disposed = true; };
  }, [verified, userId]);
  const rows = bookings && bookings.userId === user?.id ? bookings.rows : undefined;
  return <MainLayout variant="booking"><main className="mx-auto min-h-screen max-w-2xl px-4 pb-20 pt-32">
    <h1 className="text-3xl font-semibold">Your booking access</h1>
    {loading ? <p role="status">Checking your secure session…</p> : !verified ? <form className="mt-6 space-y-4" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true);
      try {
        // Do not sign up accounts on this public form. The post-confirmation
        // worker owns automatic account creation; Supabase throttles email OTPs.
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/booking/access` } });
        if (error) {
          setMessage("Email access is temporarily unavailable. Your reservation is unaffected. Please try again or contact support.");
          return;
        }
        setMessage("If account access is available for this email, a secure link will arrive shortly. Links expire and can only be used once. Your confirmed reservation remains valid if email is delayed.");
      } catch { setMessage("Email access is temporarily unavailable. Your reservation is unaffected. Please try again or contact support."); }
      finally { setBusy(false); }
    }}><p>Use the secure link in your booking email, or request a fresh access link. Opening this page alone does not verify your email.</p><label className="block space-y-2"><span>Booking email</span><Input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label><Button disabled={busy} type="submit">Email secure access link</Button><p><Link to="/auth?redirectTo=%2Fbooking%2Faccess" className="text-primary underline">Sign in to an existing account</Link></p></form> : <>
      <p className="mt-4">Signed in with your verified email.</p>
      {rows ? rows.length ? rows.map(b => <article key={b.id} className="mt-6 rounded-2xl border border-border p-5"><h2 className="text-xl font-medium">{b.vehicle}</h2><p className="mt-2">{b.startDate} – {b.endDate}</p><p>Reference: {b.reference}</p><p>Status: {b.tripStatus.replace(/_/g, " ")}</p><p>Rental total: {new Intl.NumberFormat("en-US", { style: "currency", currency: b.currency || "USD" }).format(b.totalCents / 100)}</p><p className="mt-3 text-sm text-muted-foreground">Complete identity and license verification with ZONYX before vehicle handover. Contact support for reservation changes.</p><Link to="/contact" className="mt-2 inline-block text-primary underline">Contact ZONYX</Link></article>) : <p className="mt-6">No guest reservations are linked yet. Access may take a few minutes after confirmation. Your other bookings remain in your dashboard.</p> : <p className="mt-6" role="status">Loading reservations…</p>}
      <details className="mt-8 rounded-2xl border border-border p-5"><summary className="cursor-pointer">Set or change your password (optional)</summary><form className="mt-4 space-y-4" onSubmit={async e => {
        e.preventDefault(); if (busy) return; setBusy(true);
        try {
          // The backend verifies booking access independently; setting a password
          // happens only in an already email-verified Supabase session.
          const current = await supabase.auth.getUser();
          if (current.error || !current.data.user?.email_confirmed_at || current.data.user.is_anonymous) throw new Error("Verify your email first.");
          const result = await supabase.auth.updateUser({ password });
          setMessage(result.error ? "Unable to save your password. Please request a fresh access link and try again." : "Your password has been saved.");
          if (!result.error) setPassword("");
        } catch { setMessage("Verify your email with a fresh access link before setting your password."); }
        finally { setBusy(false); }
      }}><label className="block space-y-2"><span>New password</span><Input required type="password" minLength={12} maxLength={100} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><Button disabled={busy} type="submit">Save password</Button></form></details>
      <Link to="/dashboard" className="mt-6 inline-block text-primary underline">Your dashboard</Link>
    </>}
    {message && <p role="status" className="mt-6 rounded-xl border border-border p-4">{message}</p>}
  </main></MainLayout>;
}
