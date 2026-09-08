import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useAccountMode, type AccountMode } from "@/contexts/AccountModeContext";

export function AccountModeGuard({ mode, children }: { mode: AccountMode; children: React.ReactNode }) {
  const account = useAccountMode();
  const authorized = account.allowedModes.includes(mode);
  useEffect(() => {
    if (!account.loading && authorized && account.mode !== mode) account.setMode(mode);
  }, [account, authorized, mode]);
  if (account.loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!authorized) return <Navigate to="/dashboard" replace />;
  if (account.mode !== mode) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return <>{children}</>;
}