import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAccountMode } from "@/contexts/AccountModeContext";
import { routeForAccountMode } from "@/lib/accountMode";
export default function Dashboard() {
  const { mode, loading } = useAccountMode();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return <Navigate to={routeForAccountMode(mode)} replace />;
}