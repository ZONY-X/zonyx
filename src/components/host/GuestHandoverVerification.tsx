import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export function GuestHandoverVerification({ bookingId }: { bookingId: string }) {
  const { user } = useAuth();
  const [identityChecked, setIdentityChecked] = useState(false), [licenseChecked, setLicenseChecked] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const status = useQuery({
    queryKey: ["guest-handover", bookingId, user?.id], enabled: !!user && !user.is_anonymous, retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("guest-account", { body: { action: "handover-status", bookingId } });
      if (error) throw error;
      return data as { required: boolean; verified: boolean };
    },
  });
  if (!status.data?.required) return null;
  return <div className="mt-3 rounded-xl border border-border p-3 text-sm">
    {status.data.verified ? <p>Driver identity and license checked for handover.</p> : <>
      <p className="font-medium">Required before guest vehicle handover</p>
      <label className="mt-2 flex gap-2"><input type="checkbox" checked={identityChecked} onChange={e => setIdentityChecked(e.target.checked)} /><span>I checked the driver's identity against the booking.</span></label>
      <label className="mt-2 flex gap-2"><input type="checkbox" checked={licenseChecked} onChange={e => setLicenseChecked(e.target.checked)} /><span>I checked the original driver license and its validity through the trip.</span></label>
      <Button className="mt-3" size="sm" disabled={busy || !identityChecked || !licenseChecked} onClick={async () => {
        setBusy(true); setMessage("");
        try {
          const { error } = await supabase.functions.invoke("guest-account", { body: { action: "verify-handover", bookingId, identityChecked, licenseChecked } });
          if (error) setMessage("Unable to record verification. Do not hand over the vehicle until it is recorded.");
          else await status.refetch();
        } catch { setMessage("Verification is unavailable. Do not hand over the vehicle yet."); }
        finally { setBusy(false); }
      }}>Record handover verification</Button>
    </>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </div>;
}
