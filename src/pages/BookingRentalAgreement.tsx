import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { RentalAgreementDocument } from "@/components/legal/RentalAgreementDocument";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { downloadExecutedAgreement, type ExecutedRentalAgreement } from "@/lib/executedRentalAgreement";
import { useToast } from "@/hooks/use-toast";

type PendingAmendment={id:string;booking_id:string;reservation_number:string;proposed_revision_number:number;rendered_text:string;document_hash:string;field_changes:Array<{field:string;from:string|null;to:string|null}>;reason:string;proposed_effective_at:string;created_at:string};

export default function BookingRentalAgreement() {
  const { bookingId = "" } = useParams();
  const queryClient=useQueryClient();const{toast}=useToast();
  const { data, isLoading, error } = useQuery({
    queryKey: ["booking-rental-agreement", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_booking_rental_agreement", { _booking_id: bookingId });
      if (error) throw error;
      return data as unknown as ExecutedRentalAgreement;
    },
    enabled: Boolean(bookingId),
  });
  const{data:pending}=useQuery({queryKey:["my-pending-rental-agreement-amendment",bookingId],queryFn:async()=>{const{data,error}=await supabase.rpc("get_my_pending_rental_agreement_amendment",{_booking_id:bookingId});if(error)throw error;return data as unknown as PendingAmendment|null;},enabled:Boolean(bookingId)});
  const acceptMutation=useMutation({mutationFn:async()=>{if(!pending)return;const{data,error}=await supabase.functions.invoke("rental-agreement-amendments",{body:{action:"accept",proposalId:pending.id,documentHash:pending.document_hash}});if(error)throw new Error((error as{context?:{error?:string}}).context?.error||error.message);if(data?.error)throw new Error(data.error);return data;},onSuccess:()=>{queryClient.invalidateQueries({queryKey:["booking-rental-agreement",bookingId]});queryClient.invalidateQueries({queryKey:["my-pending-rental-agreement-amendment",bookingId]});toast({title:"Rental Agreement amendment accepted",description:"The accepted amendment is now the Current Operative Agreement. No new booking or payment was created."});},onError:error=>toast({title:"Unable to accept amendment",description:error.message,variant:"destructive"})});

  if (isLoading) return <MainLayout variant="app"><main className="container min-h-screen pt-28">Loading Rental Agreement…</main></MainLayout>;
  if (error || !data) return <MainLayout variant="app"><main className="container min-h-screen pt-28">Rental Agreement unavailable.</main></MainLayout>;

  return (
    <MainLayout variant="app">
      <main className="min-h-screen pb-20 pt-24">
        <div className="container max-w-4xl">
          <article className="glass space-y-6 rounded-lg p-6 text-sm leading-relaxed text-foreground/90 md:p-10 md:text-base">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Current Operative Agreement</p><p className="font-semibold">{data.reservation_number}</p>{data.current_revision&&<p className="text-xs text-muted-foreground">Revision {data.current_revision.revision_number} · Effective {new Date(data.current_revision.effective_at).toLocaleString()}</p>}</div><Button type="button" variant="outline" onClick={()=>downloadExecutedAgreement(data)}>Download Current Operative Agreement</Button></div>
            {data.current_revision&&data.current_revision.revision_number>1&&<section className="rounded-lg border border-primary/40 bg-primary/5 p-4"><p className="font-semibold uppercase">Operative amendment revision {data.current_revision.revision_number}</p><p className="mt-2">{data.current_revision.reason}</p>{data.current_revision.field_changes.map((change,index)=><p key={index} className="text-sm">{change.field}: {change.from||"None"} → {change.to||"None"}</p>)}<p className="mt-1 break-all text-xs text-muted-foreground">Original customer-executed hash: {data.original_document_hash}</p><p className="break-all text-xs text-muted-foreground">Current operative hash: {data.current_revision.document_hash}</p></section>}
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
              {data.current_revision&&<><p>Current Operative Revision: {data.current_revision.revision_number}</p><p>Revision Authority: {data.current_revision.requires_customer_acceptance?"Authenticated customer amendment acceptance":"Authorized administrative/operational amendment"}</p>{data.current_revision.customer_accepted_at&&<p>Amendment Accepted At: {new Date(data.current_revision.customer_accepted_at).toLocaleString()}</p>}</>}
              <p>Accepted At: {new Date(data.accepted_at).toLocaleString()}</p>
              {data.audit_metadata_visible && <><p>Guest Profile ID: {data.guest_profile_id}</p><p>Guest Auth User ID: {data.guest_auth_user_id}</p><p>Prepared At: {data.prepared_at ? new Date(data.prepared_at).toLocaleString() : "Not stored"}</p><p>Accepted IP: {data.accepted_ip || "Not stored"}</p><p>User Agent / Device Record: {data.accepted_user_agent || "Not stored"}</p></>}
              <p className="break-all">Document Hash: {data.document_hash}</p>
            </section>
            {pending&&<section className="rounded-lg border-2 border-amber-500 bg-amber-500/10 p-5"><p className="font-semibold uppercase text-amber-700">Material amendment requires your acceptance</p><p className="mt-2">Proposed Revision {pending.proposed_revision_number} · Effective {new Date(pending.proposed_effective_at).toLocaleString()}</p><p className="mt-2">Reason: {pending.reason}</p>{pending.field_changes.map((change,index)=><p key={index} className="text-sm">{change.field}: {change.from||"None"} → {change.to||"None"}</p>)}<div className="my-4 max-h-[50vh] overflow-y-auto rounded border bg-background p-4"><RentalAgreementDocument text={pending.rendered_text}/></div><p className="break-all text-xs text-muted-foreground">Proposed Document Hash: {pending.document_hash}</p><Button className="mt-4" onClick={()=>acceptMutation.mutate()} disabled={acceptMutation.isPending}>{acceptMutation.isPending?"Accepting…":"Accept This Rental Agreement Amendment"}</Button><p className="mt-2 text-xs text-muted-foreground">Accepting this amendment does not create another booking or initiate a payment.</p></section>}
          </article>
          <Button asChild variant="outline" className="mt-6"><Link to="/dashboard">Back to account</Link></Button>
        </div>
      </main>
    </MainLayout>
  );
}