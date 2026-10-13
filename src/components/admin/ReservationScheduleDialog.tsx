import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";

type Dates = { start_date: string; pickup_time: string | null; end_date: string; dropoff_time: string | null };
type Quote = { before: Dates; after: Dates; current_rental_days: number; new_rental_days: number; additional_rental_days: number; extension_hours: number; daily_rate_cents: number; adjustment_cents: number; additional_charges_cents: number; credit_cents: number; current_total_cents: number; updated_total_cents: number; outstanding_adjustments_cents: number; currency: string; pricing_source: string; version: string };
type History = { id: string; action: string; before: Dates; after: Dates; adjustment_cents: number; reason: string; actor_profile_id: string; admin_name: string | null; created_at: string; renewal_period_id: string | null; payment_status: string; paid_at: string | null };
export type ReservationChanges = { booking: Dates & { id: string; reservation_number: string; trip_status: string; currency: string }; updated_total_cents: number; adjustments_cents: number; outstanding_balance_cents: number; credit_balance_cents: number; payment_collection_supported: boolean; history: History[] };
type Props = { bookingId: string; mode: "edit" | "extend"; onClose: () => void; onSaved: (data: ReservationChanges) => void };
const money = (cents: number, currency = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
const dates = (d: Dates) => `${d.start_date} ${d.pickup_time?.slice(0, 5) || "00:00"} → ${d.end_date} ${d.dropoff_time?.slice(0, 5) || "00:00"}`;

async function getReservationChanges(bookingId: string): Promise<ReservationChanges> {
  const { data, error } = await supabase.rpc("admin_get_reservation_changes", { _booking_id: bookingId });
  if (error) throw error;
  return data as unknown as ReservationChanges;
}

function ScheduleEditor({ data, mode, onSaved }: { data: ReservationChanges; mode: Props["mode"]; onSaved: Props["onSaved"] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Dates>(data.booking);
  const [reason, setReason] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const refresh = async () => {
    const updated = await getReservationChanges(data.booking.id);
    qc.setQueryData(["admin-reservation-changes", data.booking.id], updated);
    for (const key of ["host-bookings", "host-history", "booking-financial-summary", "booking-rental-agreement", "rental-agreement-history", "rental-extension-schedule"]) void qc.invalidateQueries({ queryKey: [key] });
    onSaved(updated);
  };
  const args = { _booking_id: data.booking.id, _start_date: draft.start_date, _pickup_time: draft.pickup_time || "00:00", _end_date: draft.end_date, _dropoff_time: draft.dropoff_time || "00:00", _action: mode };
  const preview = useMutation({
    mutationFn: async () => {
      setError(""); setQuote(null);
      const { data: result, error: failure } = await supabase.rpc("admin_preview_reservation_change", args);
      if (failure) throw failure;
      return result as unknown as Quote;
    },
    onSuccess: result => { setQuote(result); setRequestId(crypto.randomUUID()); },
    onError: failure => setError(failure.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      setError("");
      const { error: failure } = await supabase.rpc("admin_save_reservation_change", { ...args, _reason: reason.trim(), _expected_quote: quote as unknown as Json, _request_id: requestId });
      if (failure) throw failure;
    },
    onSuccess: async () => {
      setQuote(null);
      toast({ title: mode === "extend" ? "Reservation extended" : "Reservation updated", description: "Dates and audit history saved. No card was charged." });
      try { await refresh(); } catch (failure) { setError(`Changes were saved, but details could not refresh: ${failure instanceof Error ? failure.message : "Please reload."}`); }
    },
    onError: failure => { setError(failure.message); if (/changed|overlap|available/i.test(failure.message)) setQuote(null); },
  });
  const sendPreview = async (periodId: string) => {
    try { const { data: result, error: failure } = await supabase.functions.invoke("rental-extension-actions", { body: { action: "sendTestReminder", periodId, requestId: crypto.randomUUID() } }); if (failure || result?.error) throw new Error(result?.error || failure?.message); toast({ title: "Preview sent to your Admin email", description: "The Guest was not contacted and no reminder status changed." }); } catch (failure) { setError(failure instanceof Error ? failure.message : "Preview unavailable."); }
  };
  const pending = preview.isPending || save.isPending;
  const change = (field: keyof Dates, value: string) => { setDraft(current => ({ ...current, [field]: value })); setQuote(null); setError(""); };
  const canEditPickup = mode === "edit";
  return <div className="space-y-5">
    <section className="rounded-lg border p-3 text-sm"><p className="font-semibold">{data.booking.reservation_number}</p><p>Current reservation: {dates(data.booking)}</p><p>Reservation total: {money(data.updated_total_cents, data.booking.currency)}</p><p>Outstanding additional rental balance: {money(data.outstanding_balance_cents, data.booking.currency)}</p>{data.credit_balance_cents > 0 && <p>Credit requiring review: {money(data.credit_balance_cents, data.booking.currency)}. No automatic refund.</p>}</section>
    <fieldset disabled={pending} className="space-y-4">
      <p className="text-sm text-muted-foreground">Dates and times use the reservation’s Miami time zone (America/New_York). Each started 24-hour period counts as a rental day.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "edit" && <><div><Label htmlFor="reservation-pickup-date">Pickup date</Label><Input id="reservation-pickup-date" type="date" value={draft.start_date} disabled={!canEditPickup} onChange={e => change("start_date", e.target.value)} /></div><div><Label htmlFor="reservation-pickup-time">Pickup time</Label><Input id="reservation-pickup-time" type="time" value={draft.pickup_time?.slice(0, 5) || "00:00"} disabled={!canEditPickup} onChange={e => change("pickup_time", e.target.value)} /></div></>}
        <div><Label htmlFor="reservation-return-date">Return date</Label><Input id="reservation-return-date" type="date" value={draft.end_date} onChange={e => change("end_date", e.target.value)} /></div>
        <div><Label htmlFor="reservation-return-time">Return time</Label><Input id="reservation-return-time" type="time" value={draft.dropoff_time?.slice(0, 5) || "00:00"} onChange={e => change("dropoff_time", e.target.value)} /></div>
      </div>
      <div><Label htmlFor="reservation-change-reason">Reason for change</Label><Textarea id="reservation-change-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Required audit reason (at least five characters)" /></div>
      <Button type="button" variant="outline" onClick={() => preview.mutate()} disabled={!draft.start_date || !draft.end_date}>{preview.isPending ? "Checking availability…" : "Review Changes"}</Button>
    </fieldset>
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
    {quote && <section aria-label="Reservation price preview" className="space-y-2 rounded-lg border p-4 text-sm">
      <p className="font-semibold">Updated reservation: {dates(quote.after)}</p>
      {mode === "extend" && <p>Extension duration: {Number(quote.extension_hours).toLocaleString()} hours</p>}
      <p>Rental days: {quote.current_rental_days} → {quote.new_rental_days} ({quote.additional_rental_days >= 0 ? "+" : ""}{quote.additional_rental_days})</p>
      <p>Additional charges: {money(quote.additional_charges_cents, quote.currency)}</p>
      {quote.credit_cents > 0 && <p>Price reduction: {money(quote.credit_cents, quote.currency)}. Any refund requires separate review.</p>}
      <p className="font-semibold">Updated reservation total: {money(quote.updated_total_cents, quote.currency)}</p>
      <p>Outstanding additional rental balance after saving: {money(quote.outstanding_adjustments_cents, quote.currency)}</p>
      <p className="text-muted-foreground">{quote.pricing_source}</p>
      <p>Saving records the change without charging a card or changing the security deposit.</p>
      <Button type="button" onClick={() => save.mutate()} disabled={pending || reason.trim().length < 5}>{save.isPending ? "Saving…" : mode === "extend" ? "Confirm Extension" : "Save Changes"}</Button>
    </section>}
    <section className="space-y-3"><h3 className="font-semibold">Reservation Change History</h3>
      {data.history.length === 0 && <p className="text-sm text-muted-foreground">No admin date changes recorded.</p>}
      {data.history.map(item => <div key={item.id} className="space-y-1 rounded-lg border p-3 text-sm"><p className="font-semibold">{item.action === "extend" ? "Extension" : "Edit"} · {new Date(item.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })} · {item.admin_name || item.actor_profile_id}</p><p>Original: {dates(item.before)}</p><p>Updated: {dates(item.after)}</p><p>Price adjustment: {money(item.adjustment_cents, data.booking.currency)}</p><p>Reason: {item.reason}</p>{item.adjustment_cents > 0 && <p>Additional payment: {item.payment_status.replace(/_/g, " ")}</p>}
        {item.renewal_period_id && item.payment_status !== "paid" && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => void navigator.clipboard.writeText(`https://www.gozonyx.com/booking/renewal?periodId=${encodeURIComponent(item.renewal_period_id!)}`).then(() => toast({title:"Renewal payment link copied"})).catch(() => setError("Unable to copy the payment link."))}>Copy Guest Payment Link</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => void sendPreview(item.renewal_period_id!)}>Send Test Reminder to Me</Button></div>}
        {item.renewal_period_id && item.payment_status !== "paid" && <Button size="sm" variant="outline" asChild><Link to={`/booking/renewal?periodId=${encodeURIComponent(item.renewal_period_id)}`}>View Square Checkout</Link></Button>}
      </div>)}
      {data.outstanding_balance_cents > 0 && !data.payment_collection_supported && <p role="status" className="text-sm">Additional payment remains outstanding. Share the Guest Payment Link so the customer can review and pay this period through secure checkout. The original rental checkout must not be paid again.</p>}
    </section>

  </div>;
}

export function ReservationScheduleDialog({ bookingId, mode, onClose, onSaved }: Props) {
  const { data, isLoading, error } = useQuery({ queryKey: ["admin-reservation-changes", bookingId], queryFn: () => getReservationChanges(bookingId) });
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{mode === "extend" ? "Extend Reservation" : "Edit Reservation"}</DialogTitle><DialogDescription>Update this existing reservation while preserving customer, vehicle, payment history, and security-deposit records.</DialogDescription></DialogHeader>
    {isLoading && <p>Loading reservation…</p>}{error && <p role="alert">{error.message}</p>}{data && <ScheduleEditor key={`${bookingId}-${mode}`} data={data} mode={mode} onSaved={onSaved} />}
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogFooter>
  </DialogContent></Dialog>;
}
