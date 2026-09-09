import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildFinancialInspectorRequest, formatInspectorMoney, formatStripeTimestamp } from "@/lib/financialInspector";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FunctionsHttpError } from "@supabase/supabase-js";

type StripeCharge = {
  id: string | null; amount: number | null; amount_captured: number | null; amount_refunded: number | null;
  captured: boolean | null; refunded: boolean | null; status: string | null; created: number | null; receipt_url: string | null;
};
type StripeRefund = { id: string | null; amount: number | null; currency: string | null; status: string | null; created: number | null; reason: string | null };
type DepositEvidence = { source_type?: string; source_id?: string | null; event_type?: string | null; created?: number | null; proves?: string; amount?: number | null; status?: string | null };
type DepositHistory = { historical_capture_status: string; historical_captured_amount: number | null; historical_released_uncaptured_amount: number | null; historical_refunded_amount: number; event_history_available: boolean; evidence: DepositEvidence[]; balance_transactions: { id: string | null; amount: number | null; fee: number | null; net: number | null; currency: string | null; type: string | null; status: string | null; created: number | null; available_on: number | null; source_id: string | null }[] };
type Snapshot = {
  booking: { booking_id: string; reservation_code: string };
  checkout: null | { id: string | null; status: string | null; payment_status: string | null; amount_subtotal: number | null; amount_total: number | null; currency: string | null; created: number | null; line_items: { id: string | null; description: string | null; quantity: number | null; unit_amount: number | null; amount_total: number | null; currency: string | null }[]; discounts: unknown[] };
  rental_payment: null | { payment_intent_id: string | null; status: string | null; amount: number | null; amount_received: number | null; amount_capturable: number | null; currency: string | null; created: number | null; latest_charge: StripeCharge | null; refunds: StripeRefund[] };
  security_deposit: null | { payment_intent_id: string | null; stripe_status: string | null; original_authorization: number | null; amount_received: number | null; captured_amount: number | null; amount_capturable: number | null; released_or_uncaptured_amount: number | null; settled: boolean; canceled_at: number | null; created: number | null; latest_charge: StripeCharge | null; history: DepositHistory };
  safe_payment_method: { brand: string | null; last4: string | null };
  observed_at: string;
};
type BookingOption = { id: string; reservation_number: string; trip_status: string; renter: { full_name: string | null; email: string | null } | null; vehicles: { year: number; brand: string; model: string } | null };

const Value = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="break-all text-sm font-medium">{children ?? "Unknown"}</p></div>;
const ChargeDetails = ({ charge, currency }: { charge: StripeCharge | null; currency?: string | null }) => charge ? <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-3"><Value label="Charge ID">{charge.id}</Value><Value label="Amount">{formatInspectorMoney(charge.amount, currency || "usd")}</Value><Value label="Captured">{formatInspectorMoney(charge.amount_captured, currency || "usd")}</Value><Value label="Refunded">{formatInspectorMoney(charge.amount_refunded, currency || "usd")}</Value><Value label="State">{charge.status || (charge.captured ? "captured" : "not captured")}</Value><Value label="Created">{formatStripeTimestamp(charge.created)}</Value></div> : <p className="text-sm text-muted-foreground">No Stripe Charge was returned.</p>;

export function FinancialInspectorTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["admin-financial-inspector-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings").select("id, reservation_number, trip_status, renter:profiles!bookings_renter_profile_id_fkey(full_name, email), vehicles(year, brand, model)").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BookingOption[];
    },
  });
  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return bookings;
    return bookings.filter((booking) => [booking.reservation_number, booking.trip_status, booking.renter?.full_name, booking.renter?.email, booking.vehicles?.year, booking.vehicles?.brand, booking.vehicles?.model].join(" ").toLowerCase().includes(needle));
  }, [bookings, search]);

  const inspect = async () => {
    if (!selectedId) return;
    setInspecting(true);
    setSnapshot(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setInspecting(false);
      toast({ title: "Unable to inspect Stripe", description: "AUTH_SESSION_MISSING — Sign in again to refresh the Admin session.", variant: "destructive" });
      return;
    }
    const { data, error } = await supabase.functions.invoke("stripe-financial-inspector", { headers: { Authorization: `Bearer ${accessToken}` }, body: buildFinancialInspectorRequest(selectedId) });
    setInspecting(false);
    if (error) {
      let description = "INTERNAL_READ_ERROR — Stripe inspection failed without modifying any data.";
      if (error instanceof FunctionsHttpError) {
        try {
          const body = await error.context.json() as { code?: string; error?: string };
          description = `${body.code || "INTERNAL_READ_ERROR"} — ${body.error || "Unable to retrieve the read-only snapshot."}`;
        } catch { /* retain safe fallback */ }
      }
      toast({ title: "Unable to inspect Stripe", description, variant: "destructive" });
      return;
    }
    setSnapshot(data as Snapshot);
  };

  return <div className="space-y-6">
    <Card className="border-primary/30">
      <CardHeader><div className="flex items-center gap-3"><Eye className="h-5 w-5 text-primary" /><div><CardTitle>READ-ONLY STRIPE SNAPSHOT</CardTitle><CardDescription>Live financial state retrieved from Stripe. Viewing this data does not modify the booking or move funds.</CardDescription></div></div></CardHeader>
      <CardContent className="space-y-4">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reservation, guest, vehicle, or status" /></div>
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
          {isLoading ? <p className="p-3 text-sm text-muted-foreground">Loading bookings...</p> : results.map((booking) => <button key={booking.id} type="button" onClick={() => { setSelectedId(booking.id); setSnapshot(null); }} className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedId === booking.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{booking.reservation_number}</span><Badge variant="secondary">{booking.trip_status.replace(/_/g, " ")}</Badge></div>
            <p className="mt-1 text-sm text-muted-foreground">{booking.renter?.full_name || booking.renter?.email || "Guest unavailable"} · {booking.vehicles?.year} {booking.vehicles?.brand} {booking.vehicles?.model}</p>
          </button>)}
          {!isLoading && results.length === 0 && <p className="p-3 text-sm text-muted-foreground">No matching bookings.</p>}
        </div>
        <Button onClick={inspect} disabled={!selectedId || inspecting}><RefreshCw className={`mr-2 h-4 w-4 ${inspecting ? "animate-spin" : ""}`} />{snapshot ? "Refresh Snapshot" : "Inspect Stripe"}</Button>
      </CardContent>
    </Card>

    {snapshot && <div className="space-y-6">
      <Card><CardHeader><CardTitle>Booking</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Value label="Reservation">{snapshot.booking.reservation_code}</Value><Value label="Booking ID">{snapshot.booking.booking_id}</Value></CardContent></Card>
      <Card><CardHeader><CardTitle>Checkout</CardTitle></CardHeader><CardContent className="space-y-4">{snapshot.checkout ? <><div className="grid gap-4 sm:grid-cols-3"><Value label="Session">{snapshot.checkout.id}</Value><Value label="Status">{snapshot.checkout.status}</Value><Value label="Payment status">{snapshot.checkout.payment_status}</Value><Value label="Subtotal">{formatInspectorMoney(snapshot.checkout.amount_subtotal, snapshot.checkout.currency || "usd")}</Value><Value label="Total">{formatInspectorMoney(snapshot.checkout.amount_total, snapshot.checkout.currency || "usd")}</Value><Value label="Created">{formatStripeTimestamp(snapshot.checkout.created)}</Value></div><div><p className="mb-2 text-sm font-semibold">Line items</p>{snapshot.checkout.line_items.map((line) => <div key={line.id || line.description} className="flex justify-between border-t border-border py-2 text-sm"><span>{line.description} × {line.quantity ?? "?"}</span><span>{formatInspectorMoney(line.amount_total, line.currency || snapshot.checkout?.currency || "usd")}</span></div>)}{snapshot.checkout.line_items.length === 0 && <p className="text-sm text-muted-foreground">No line items returned.</p>}</div></> : <p className="text-sm text-muted-foreground">No Checkout Session is associated with this booking.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Rental Payment</CardTitle></CardHeader><CardContent className="space-y-4">{snapshot.rental_payment ? <><div className="grid gap-4 sm:grid-cols-3"><Value label="PaymentIntent">{snapshot.rental_payment.payment_intent_id}</Value><Value label="Status">{snapshot.rental_payment.status}</Value><Value label="Amount">{formatInspectorMoney(snapshot.rental_payment.amount, snapshot.rental_payment.currency || "usd")}</Value><Value label="Received">{formatInspectorMoney(snapshot.rental_payment.amount_received, snapshot.rental_payment.currency || "usd")}</Value><Value label="Capturable">{formatInspectorMoney(snapshot.rental_payment.amount_capturable, snapshot.rental_payment.currency || "usd")}</Value><Value label="Created">{formatStripeTimestamp(snapshot.rental_payment.created)}</Value></div><ChargeDetails charge={snapshot.rental_payment.latest_charge} currency={snapshot.rental_payment.currency} /><div><p className="mb-2 text-sm font-semibold">Refunds</p>{snapshot.rental_payment.refunds.map((refund) => <div key={refund.id || String(refund.created)} className="grid gap-2 border-t border-border py-3 text-sm sm:grid-cols-4"><Value label="Refund ID">{refund.id}</Value><Value label="Amount">{formatInspectorMoney(refund.amount, refund.currency || "usd")}</Value><Value label="Status">{refund.status}</Value><Value label="Created">{formatStripeTimestamp(refund.created)}</Value></div>)}{snapshot.rental_payment.refunds.length === 0 && <p className="text-sm text-muted-foreground">No Stripe refunds returned.</p>}</div></> : <p className="text-sm text-muted-foreground">No rental PaymentIntent was returned.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Security Deposit</CardTitle></CardHeader><CardContent className="space-y-4">{snapshot.security_deposit ? <><div className="grid gap-4 sm:grid-cols-3"><Value label="PaymentIntent">{snapshot.security_deposit.payment_intent_id}</Value><Value label="Current Stripe state">{snapshot.security_deposit.stripe_status}</Value><Value label="Settled">{snapshot.security_deposit.settled ? "Yes" : "No"}</Value><Value label="Original authorization">{formatInspectorMoney(snapshot.security_deposit.original_authorization)}</Value><Value label="Current capturable">{formatInspectorMoney(snapshot.security_deposit.amount_capturable)}</Value><Value label="Created">{formatStripeTimestamp(snapshot.security_deposit.created)}</Value></div><ChargeDetails charge={snapshot.security_deposit.latest_charge} /><div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4"><h3 className="font-semibold uppercase tracking-wide">Security Deposit History</h3><div className="grid gap-4 sm:grid-cols-3"><Value label="Historical status">{snapshot.security_deposit.history.historical_capture_status.replace(/_/g, " ")}</Value><Value label="Historical captured">{formatInspectorMoney(snapshot.security_deposit.history.historical_captured_amount)}</Value><Value label="Historical released / uncaptured">{formatInspectorMoney(snapshot.security_deposit.history.historical_released_uncaptured_amount)}</Value><Value label="Historical refunded">{formatInspectorMoney(snapshot.security_deposit.history.historical_refunded_amount)}</Value><Value label="Event evidence retained">{snapshot.security_deposit.history.event_history_available ? "Yes" : "No / unavailable"}</Value></div><div><p className="mb-2 text-sm font-semibold">Stripe evidence</p>{snapshot.security_deposit.history.evidence.map((item, index) => <div key={`${item.source_id}-${index}`} className="grid gap-2 border-t border-border py-3 text-sm sm:grid-cols-4"><Value label="Source">{item.source_type}</Value><Value label="Stripe ID">{item.source_id}</Value><Value label="Proves">{item.proves}</Value><Value label="Amount">{formatInspectorMoney(item.amount)}</Value></div>)}{snapshot.security_deposit.history.evidence.length === 0 && <p className="text-sm text-muted-foreground">Stripe retained no evidence sufficient to prove historical capture or release amounts. History remains Unknown.</p>}</div></div></> : <p className="text-sm text-muted-foreground">No security-deposit PaymentIntent is associated with this booking.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Payment Method</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><Value label="Brand">{snapshot.safe_payment_method.brand}</Value><Value label="Last 4">{snapshot.safe_payment_method.last4}</Value><Value label="Observed">{new Date(snapshot.observed_at).toLocaleString()}</Value></CardContent></Card>
    </div>}
  </div>;
}