import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { RentalAgreementDocument } from "@/components/legal/RentalAgreementDocument";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export default function BookingRentalAgreement() {
  const { bookingId = "" } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["booking-rental-agreement", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_booking_rental_agreement", { _booking_id: bookingId });
      if (error) throw error;
      return data as { id: string; booking_id: string; master_agreement_id: string; master_version: string; agreement_effective_at: string; accepted_at: string; document_hash: string; rendered_text: string; trip_financial_summary: { vehicle_vin?: string } };
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
            <RentalAgreementDocument text={data.rendered_text} />
            <section className="border-t border-border pt-6 text-xs text-muted-foreground md:text-sm">
              <p>Immutable Agreement ID: {data.id}</p>
              <p>Agreement Version ID: {data.master_agreement_id}</p>
              <p>Master Agreement Version: {data.master_version}</p>
              <p>Agreement Effective At: {new Date(data.agreement_effective_at).toLocaleString()}</p>
              {data.trip_financial_summary?.vehicle_vin && <p>Vehicle VIN: {data.trip_financial_summary.vehicle_vin}</p>}
              <p>Accepted At: {new Date(data.accepted_at).toLocaleString()}</p>
              <p className="break-all">Document Hash: {data.document_hash}</p>
            </section>
          </article>
          <Button asChild variant="outline" className="mt-6"><Link to="/dashboard">Back to account</Link></Button>
        </div>
      </main>
    </MainLayout>
  );
}