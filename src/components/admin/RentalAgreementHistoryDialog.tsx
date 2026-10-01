import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { downloadAgreementRevision, type AgreementHistory } from "@/lib/executedRentalAgreement";
import { useToast } from "@/hooks/use-toast";

type Props = { bookingId: string | null; open: boolean; onOpenChange: (open: boolean) => void };

export function RentalAgreementHistoryDialog({ bookingId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["rental-agreement-history", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_agreement_history", { _booking_id: bookingId! });
      if (error) throw error;
      return data as unknown as AgreementHistory;
    },
    enabled: open && Boolean(bookingId),
  });
  const notifyMutation = useMutation({
    mutationFn: async (payload: { revisionId?: string; proposalId?: string }) => {
      const { data, error } = await supabase.functions.invoke("rental-agreement-amendments", { body: { action: "notify", ...payload } });
      if (error) throw new Error((error as { context?: { error?: string } }).context?.error || error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-agreement-history", bookingId] });
      toast({ title: "Guest notification sent", description: "The deliberate Admin communication and provider evidence were recorded." });
    },
    onError: (error) => toast({ title: "Guest notification failed", description: error.message, variant: "destructive" }),
  });

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
    <DialogHeader><DialogTitle>Agreement History</DialogTitle><DialogDescription>Every revision is immutable. No Guest communication is sent unless an Admin explicitly chooses an action below.</DialogDescription></DialogHeader>
    {isLoading ? <p>Loading…</p> : <div className="space-y-4">
      {data?.revisions.map((revision) => <section key={revision.id} className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">Revision {revision.revision_number} {revision.id === data.current_revision_id && <span className="ml-2 text-primary">Current Operative Agreement</span>}</p><p className="text-sm text-muted-foreground">{revision.revision_type.replaceAll("_", " ")} · Effective {new Date(revision.effective_at).toLocaleString()}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => downloadAgreementRevision(data.reservation_number, revision)}>Download exact revision</Button>{revision.id === data.current_revision_id && <Button size="sm" onClick={() => notifyMutation.mutate({ revisionId: revision.id })} disabled={notifyMutation.isPending}>Notify Guest</Button>}</div></div>
        <p className="mt-2 text-sm">Reason: {revision.reason}</p>{revision.field_changes.map((change, index) => <p key={index} className="text-sm">{change.field}: {change.from || "None"} → {change.to || "None"}</p>)}<p className="mt-2 break-all text-xs text-muted-foreground">Hash: {revision.document_hash}</p>{revision.requires_customer_acceptance && <p className="text-xs">Guest accepted: {revision.customer_accepted_at ? new Date(revision.customer_accepted_at).toLocaleString() : "No"}</p>}
      </section>)}
      {data?.pending_proposals.map((proposal) => <section key={proposal.id} className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-4"><p className="font-semibold">Proposed Revision {proposal.proposed_revision_number} — Pending Guest Acceptance</p><p className="text-sm">{proposal.reason}</p><p className="break-all text-xs text-muted-foreground">Hash: {proposal.document_hash}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => downloadAgreementRevision(data.reservation_number, proposal)}>Download proposal</Button><Button size="sm" onClick={() => notifyMutation.mutate({ proposalId: proposal.id })} disabled={notifyMutation.isPending}>Send Amendment Request</Button></div></section>)}
      <section><h3 className="font-semibold">Notification Evidence</h3>{data?.notifications.length ? data.notifications.map((item) => <p key={item.id} className="mt-2 text-sm">{new Date(item.attempted_at).toLocaleString()} · {item.notification_type.replaceAll("_", " ")} · {item.status} · {item.recipient_email}{item.provider_message_id ? ` · ${item.provider_message_id}` : ""}{item.error_message ? ` · ${item.error_message}` : ""}</p>) : <p className="text-sm text-muted-foreground">No amendment notifications recorded.</p>}</section>
    </div>}
  </DialogContent></Dialog>;
}