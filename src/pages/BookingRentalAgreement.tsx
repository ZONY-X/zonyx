import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { RentalAgreementDocument } from "@/components/legal/RentalAgreementDocument";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { downloadExecutedAgreement, type ExecutedRentalAgreement } from "@/lib/executedRentalAgreement";

export default function BookingRentalAgreement() {
  const { bookingId = "" } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["booking-rental-agreement", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_booking_rental_agreement", { _booking_id: bookingId });
      if (error) throw error;
      return data as unknown as ExecutedRentalAgreement;
    },
    enabled: Boolean(bookingId),
  });

  if (isLoading) return <MainLayout variant="app"><main className="container min-h-screen pt-28">Loading Rental Agreement…</main></MainLayout>;
  if (error || !data) return <MainLayout variant="app"><main className="container min-h-screen pt-28">Rental Agreement unavailable.</main></MainLayout>;

  return (
    <MainLayout variant="app">
      <main className="min-h-screen pb-20 pt-24">
        <div className="container max-w-4xl">
          <article className="glass space-y-6 rounded-lg p-6 text-sm leading-relaxed text-foreground/90 md:p-10 md:text-base">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Executed Rental Agreement</p><p className="font-semibold">{data.reservation_number}</p></div><Button type="button" variant="outline" onClick={()=>downloadExecutedAgreement(data)}>Download exact executed agreement</Button></div>
            {data.correction && <section className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-4"><p className="font-semibold uppercase text-amber-700">Administrative correction — no new customer acceptance</p><p className="mt-2">{data.correction.exact_correction}</p><p className="mt-1 text-xs text-muted-foreground">Reason: {data.correction.reason} · Corrected: {new Date(data.correction.corrected_at).toLocaleString()}</p><p className="mt-1 break-all text-xs text-muted-foreground">Original customer-accepted hash: {data.correction.original_document_hash}</p><p className="break-all text-xs text-muted-foreground">Corrected administrative representation hash: {data.correction.corrected_document_hash}</p></section>}
            <RentalAgreementDocument text={data.rendered_text} />
            <section className="border-t border-border pt-6 text-xs text-muted-foreground md:text-sm">
              <p>Immutable Agreement ID: {data.id}</p>
              <p>Agreement Version ID: {data.master_agreement_id}</p>
              <p>Master Agreement Version: {data.master_version}</p>
              <p>Agreement Effective At: {new Date(data.agreement_effective_at).toLocaleString()}</p>
              <p className="break-all">Master Canonical Hash: {data.master_content_hash}</p>
              <p>Reservation ID: {data.reservation_number} / {data.booking_id}</p>
              <p>Vehicle VIN: {data.trip_financial_summary?.vehicle_vin || "Not stored in this executed snapshot"}</p>
              <p>Signature Method: Authenticated electronic acceptance (no separate signature image stored)</p>
              {data.correction && <p>Customer Reaccepted Correction: No</p>}
              <p>Accepted At: {new Date(data.accepted_at).toLocaleString()}</p>
              {data.audit_metadata_visible && <><p>Guest Profile ID: {data.guest_profile_id}</p><p>Guest Auth User ID: {data.guest_auth_user_id}</p><p>Prepared At: {data.prepared_at ? new Date(data.prepared_at).toLocaleString() : "Not stored"}</p><p>Accepted IP: {data.accepted_ip || "Not stored"}</p><p>User Agent / Device Record: {data.accepted_user_agent || "Not stored"}</p></>}
              <p className="break-all">Document Hash: {data.document_hash}</p>
            </section>
          </article>
          <Button asChild variant="outline" className="mt-6"><Link to="/dashboard">Back to account</Link></Button>
        </div>
      </main>
    </MainLayout>
  );
}