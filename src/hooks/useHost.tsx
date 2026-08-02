import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface Host {
  id: string;
  user_id: string;
  email: string;
  avatar_url: string | null;
  full_name: string;
  phone: string | null;
  is_host: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export function useHost() {
  const { user } = useAuth();

  const { data: host, isLoading, error, refetch } = useQuery({
    queryKey: ["host", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_host", true)
        .maybeSingle();

      if (error) throw error;
      return data as Host | null;
    },
    enabled: !!user?.id,
  });

  return {
    host,
    isHost: !!host,
    isApproved: !!host?.is_host,
    isLoading,
    error,
    refetch,
  };
}
