import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

type Config = { active_provider: string; version: number; providers: { id: string; status: string; activatable: boolean }[] };
async function runtime(input: Record<string, unknown>): Promise<Config> {
  const { data, error } = await supabase.functions.invoke("admin-payment-runtime", { body: input });
  if (error) {
    let message = "ZONYX Pay configuration unavailable. Refresh and try again.";
    try { message = (await error.context.json()).error || message; } catch { /* no response body */ }
    throw new Error(message);
  }
  return data;
}
export function PaymentRuntimeTab() {
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const query = useQuery({ queryKey: ["payment-runtime"], queryFn: () => runtime({ action: "read" }), retry: false });
  const config = query.data;
  const choice = selected || config?.active_provider || "none";
  async function activate() {
    if (!config || pending) return;
    setPending(true); setMessage("");
    try {
      await runtime({ action: "activate", provider: choice, expectedVersion: config.version, reason: reason.trim() || undefined });
      setMessage("Active processor updated."); setSelected(""); setReason("");
      await query.refetch();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Processor change failed."); await query.refetch(); }
    finally { setPending(false); setConfirm(false); }
  }
  return <section className="space-y-4 rounded-lg border p-6" aria-label="ZONYX Pay configuration">
    <h2 className="text-xl font-semibold">ZONYX Pay</h2>
    <p>Control the processor for new transactions. Existing payments keep their original processor. There is no automatic fallback.</p>
    {query.isLoading && <p role="status">Loading ZONYX Pay…</p>}
    {query.isError && <p role="alert">Configuration unavailable. New transactions remain protected. <Button onClick={() => query.refetch()}>Retry</Button></p>}
    {config && !query.isError && <>
      <p>Active processor: <strong>{config.active_provider === "none" ? "No active processor" : config.active_provider}</strong></p>
      {config.active_provider === "none" && <p>New transactions are blocked.</p>}
      {config.active_provider !== "none" && !config.providers.some(p => p.id === config.active_provider && p.activatable) && <p role="alert">Active processor is not ready. New transactions are blocked.</p>}
      <label className="block">Processor<select aria-label="Processor" className="ml-3 rounded border bg-background p-2" value={choice} disabled={pending} onChange={e => setSelected(e.target.value)}>
        <option value="none">No active processor</option>
        {config.providers.map(p => <option key={p.id} value={p.id} disabled={!p.activatable}>{p.id} — {p.status}</option>)}
      </select></label>
      <ul>{config.providers.map(p => <li key={p.id}>{p.id}: {p.status}</li>)}</ul>
      <label className="block">Reason (optional)<input aria-label="Reason (optional)" className="ml-3 rounded border bg-background p-2" value={reason} maxLength={500} disabled={pending} onChange={e => setReason(e.target.value)} /></label>
      <Button disabled={pending || query.isFetching || choice === config.active_provider} onClick={() => setConfirm(true)}>Set active processor</Button>
      <AlertDialog open={confirm} onOpenChange={open => { if (!pending) setConfirm(open); }}><AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Change ZONYX Pay processor?</AlertDialogTitle><AlertDialogDescription>Change from {config.active_provider} to {choice}. {choice === "none" ? "This blocks new transactions." : "This applies to new transactions only."} Existing payments keep their original processor.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={e => { e.preventDefault(); void activate(); }}>{pending ? "Saving…" : "Confirm activation"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent></AlertDialog>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
