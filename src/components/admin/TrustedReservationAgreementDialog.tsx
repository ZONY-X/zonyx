import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { fromZonedTime } from "date-fns-tz";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; vehicleId: string; startDate: string; endDate: string; pickupTime: string; dropoffTime: string; pickupLocation: string; dropoffLocation: string; buildUrl: (contextId: string) => string };

export function TrustedReservationAgreementDialog(props: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [guestEmail, setGuestEmail] = useState("");
  const [drivers, setDrivers] = useState("");
  const [hasProtection, setHasProtection] = useState(false);
  const [source, setSource] = useState("Admin verified record");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [certificate, setCertificate] = useState("");
  const [insuredDriver, setInsuredDriver] = useState("");
  const [coverageStart, setCoverageStart] = useState("");
  const [coverageEnd, setCoverageEnd] = useState("");
  const [limit, setLimit] = useState("");

  const submit = async () => {
    setSaving(true);
    const additionalDrivers = drivers.split("\n").map((value) => value.trim()).filter(Boolean).map((fullLegalName) => ({ full_legal_name: fullLegalName, approval_status: "approved" }));
    const protection = hasProtection ? { provider: "CarInsuRent", product: "Rental Vehicle Excess Protection", insured_primary_driver_name: insuredDriver.trim(), policy_or_certificate_number: certificate.trim(), coverage_start_at: fromZonedTime(coverageStart, "America/New_York").toISOString(), coverage_end_at: fromZonedTime(coverageEnd, "America/New_York").toISOString(), protection_limit_cents: limit ? Math.round(Number(limit) * 100) : null, rental_vehicle_excess_cents: 50000, currency: "usd" } : null;
    const { data, error } = await supabase.rpc("admin_create_reservation_agreement_context", { _guest_email: guestEmail.trim(), _vehicle_id: props.vehicleId, _start_date: props.startDate, _pickup_time: props.pickupTime, _end_date: props.endDate, _dropoff_time: props.dropoffTime, _pickup_location: props.pickupLocation, _dropoff_location: props.dropoffLocation, _protection: protection, _additional_drivers: additionalDrivers, _administrative_source: source.trim(), _administrative_source_reference: reference.trim(), _reason: reason.trim() });
    setSaving(false);
    if (error) return toast({ title: "Unable to save trusted reservation details", description: error.message, variant: "destructive" });
    const row = data?.[0];
    if (!row) return;
    const url = props.buildUrl(row.reservation_context_id);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Trusted booking link copied", description: "Protection and approved drivers are stored server-side and bound to this reservation." });
      props.onOpenChange(false);
    } catch {
      toast({ title: "Trusted details saved", description: url });
    }
  };

  const protectionIncomplete = hasProtection && (!insuredDriver.trim() || !certificate.trim() || !coverageStart || !coverageEnd);
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Trusted reservation details</DialogTitle><DialogDescription>Admin-only verified inputs used by the immutable Rental Agreement snapshot.</DialogDescription></DialogHeader><div className="space-y-4">
    <div className="space-y-2"><Label>Guest email</Label><Input type="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} /></div>
    <div className="space-y-2"><Label>Approved Additional Authorized Drivers</Label><Textarea value={drivers} onChange={(event) => setDrivers(event.target.value)} placeholder="One full legal name per line" /></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasProtection} onChange={(event) => setHasProtection(event.target.checked)} /> Verified CarInsuRent Rental Vehicle Excess Protection</label>
    {hasProtection && <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"><div className="space-y-2"><Label>Insured Primary Authorized Driver</Label><Input value={insuredDriver} onChange={(event) => setInsuredDriver(event.target.value)} /></div><div className="space-y-2"><Label>Policy / certificate number</Label><Input value={certificate} onChange={(event) => setCertificate(event.target.value)} /></div><div className="space-y-2"><Label>Coverage starts (Miami time)</Label><Input type="datetime-local" value={coverageStart} onChange={(event) => setCoverageStart(event.target.value)} /></div><div className="space-y-2"><Label>Coverage ends (Miami time)</Label><Input type="datetime-local" value={coverageEnd} onChange={(event) => setCoverageEnd(event.target.value)} /></div><div className="space-y-2"><Label>Protection limit (USD, optional)</Label><Input type="number" min="0" step="0.01" value={limit} onChange={(event) => setLimit(event.target.value)} /></div><p className="self-end text-sm text-muted-foreground">Rental Vehicle Excess: US$500</p></div>}
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Administrative source</Label><Input value={source} onChange={(event) => setSource(event.target.value)} /></div><div className="space-y-2"><Label>Source reference</Label><Input value={reference} onChange={(event) => setReference(event.target.value)} /></div></div>
    <div className="space-y-2"><Label>Administrative reason / note</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
  </div><DialogFooter><Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={saving || !guestEmail.trim() || reason.trim().length < 5 || source.trim().length < 2 || protectionIncomplete}>{saving ? "Saving..." : "Save and copy trusted link"}</Button></DialogFooter></DialogContent></Dialog>;
}