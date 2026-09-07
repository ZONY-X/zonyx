import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getSafeEligibilityReturnPath, type DriverEligibilityStatus } from "@/lib/driverEligibility";

interface EligibilityRow {
  legal_name: string | null;
  date_of_birth: string | null;
  license_issuing_country: string | null;
  license_issuing_region: string | null;
  license_expiration_date: string | null;
  self_attested_at: string | null;
  status: DriverEligibilityStatus;
}

export default function DriverEligibility() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const returnTo = getSafeEligibilityReturnPath(searchParams.get("returnTo"));
  const tripEnd = searchParams.get("tripEnd");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<EligibilityRow["status"]>("incomplete");
  const [attested, setAttested] = useState(false);
  const [form, setForm] = useState({
    legalName: "",
    dateOfBirth: "",
    issuingCountry: "",
    issuingRegion: "",
    expirationDate: "",
  });

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data, error } = await supabase.rpc("get_my_driver_eligibility", { _trip_end_date: tripEnd || undefined });
      if (!error && data?.[0]) {
        const row = data[0] as EligibilityRow;
        setStatus(row.status);
        setForm({
          legalName: row.legal_name ?? "",
          dateOfBirth: row.date_of_birth ?? "",
          issuingCountry: row.license_issuing_country ?? "",
          issuingRegion: row.license_issuing_region ?? "",
          expirationDate: row.license_expiration_date ?? "",
        });
      }
      setLoading(false);
    })();
  }, [tripEnd, user]);

  if (!authLoading && !user) {
    const destination = `/driver-eligibility?${searchParams.toString()}`;
    return <Navigate to={`/auth?redirectTo=${encodeURIComponent(destination)}`} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const { data, error } = await supabase.rpc("submit_my_driver_eligibility", {
      _legal_name: form.legalName,
      _date_of_birth: form.dateOfBirth,
      _license_issuing_country: form.issuingCountry,
      _license_issuing_region: form.issuingRegion,
      _license_expiration_date: form.expirationDate,
      _attested: attested,
      _trip_end_date: tripEnd || undefined,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Unable to save eligibility", description: error.message, variant: "destructive" });
      return;
    }
    const nextStatus = data as EligibilityRow["status"];
    setStatus(nextStatus);
    if (nextStatus === "age_ineligible") {
      toast({ title: "Booking unavailable", description: "You must be at least 18 years old to book with ZONYX.", variant: "destructive" });
      return;
    }
    if (nextStatus === "license_expired") {
      toast({ title: "License validity required", description: "Your driver license must remain valid through the trip end date.", variant: "destructive" });
      return;
    }
    navigate(returnTo, { replace: true });
  };

  return (
    <MainLayout>
      <section className="min-h-screen px-4 pb-20 pt-28">
        <Card className="mx-auto max-w-2xl border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle className="font-display text-2xl tracking-wide">Driver eligibility</CardTitle>
            <CardDescription>Self-attest your basic driving eligibility before booking. ZONYX does not verify your identity or license in this step.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || authLoading ? <p className="text-muted-foreground">Loading eligibility...</p> : (
              <form className="space-y-5" onSubmit={handleSubmit}>
                {status === "age_ineligible" && <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">You must be at least 18 years old to book with ZONYX.</p>}
                {status === "license_expired" && <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Your driver license must remain valid through the selected trip end date.</p>}
                <div className="space-y-2"><Label htmlFor="legal-name">Legal name</Label><Input id="legal-name" required autoComplete="name" value={form.legalName} onChange={event => setForm({ ...form, legalName: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="date-of-birth">Date of birth</Label><Input id="date-of-birth" required type="date" value={form.dateOfBirth} onChange={event => setForm({ ...form, dateOfBirth: event.target.value })} /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="issuing-country">License issuing country</Label><Input id="issuing-country" required autoComplete="country-name" value={form.issuingCountry} onChange={event => setForm({ ...form, issuingCountry: event.target.value })} /></div>
                  <div className="space-y-2"><Label htmlFor="issuing-region">License issuing state/region</Label><Input id="issuing-region" required autoComplete="address-level1" value={form.issuingRegion} onChange={event => setForm({ ...form, issuingRegion: event.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label htmlFor="license-expiration">License expiration</Label><Input id="license-expiration" required type="date" value={form.expirationDate} onChange={event => setForm({ ...form, expirationDate: event.target.value })} /></div>
                <label className="flex items-start gap-3 text-sm text-foreground">
                  <input type="checkbox" required checked={attested} onChange={event => setAttested(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
                  <span>I attest that this information is accurate and that I am legally eligible to drive.</span>
                </label>
                <Button type="submit" className="w-full" size="lg" disabled={saving || !attested}>{saving ? "Saving..." : "Save and continue"}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </section>
    </MainLayout>
  );
}