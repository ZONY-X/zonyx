import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getAllowedAccountModes, resolveAccountMode, type AccountCapabilities, type AccountMode } from "@/lib/accountMode";
export type { AccountMode } from "@/lib/accountMode";

interface AccountModeValue {
  capabilities: AccountCapabilities | null;
  loading: boolean;
  mode: AccountMode;
  allowedModes: AccountMode[];
  setMode: (mode: AccountMode) => boolean;
}

const STORAGE_KEY = "zonyx-account-mode";
const AccountModeContext = createContext<AccountModeValue | undefined>(undefined);

export function AccountModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [mode, setModeState] = useState<AccountMode>("guest");
  const { data: capabilities = null, isLoading } = useQuery({
    queryKey: ["account-capabilities", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase.rpc("get_my_account_capabilities");
      if (error) throw error;
      return (data?.[0] ?? null) as AccountCapabilities | null;
    },
    enabled: !!user,
  });

  const allowedModes = useMemo(() => getAllowedAccountModes(capabilities), [capabilities]);

  useEffect(() => {
    if (!user) {
      setModeState("guest");
      return;
    }
    if (isLoading || !capabilities) return;
    const requested = window.localStorage.getItem(STORAGE_KEY) as AccountMode | null;
    const safeMode = resolveAccountMode(requested, capabilities);
    setModeState(safeMode);
    window.localStorage.setItem(STORAGE_KEY, safeMode);
  }, [allowedModes, capabilities, isLoading, user]);

  const setMode = (requested: AccountMode) => {
    if (!allowedModes.includes(requested)) {
      setModeState("guest");
      window.localStorage.setItem(STORAGE_KEY, "guest");
      return false;
    }
    setModeState(requested);
    window.localStorage.setItem(STORAGE_KEY, requested);
    return true;
  };

  return (
    <AccountModeContext.Provider value={{ capabilities, loading: isLoading, mode, allowedModes, setMode }}>
      {children}
    </AccountModeContext.Provider>
  );
}

export function useAccountMode() {
  const value = useContext(AccountModeContext);
  if (!value) throw new Error("useAccountMode must be used within AccountModeProvider");
  return value;
}