import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface Host {
  id: string;
  user_id: string;
  host_name: string;
  email: string;
  bio: string | null;
  avatar_url: string | null;
  is_approved: boolean;
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
        .from("hosts")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data as Host | null;
    },
    enabled: !!user?.id,
  });

  return {
    host,
    isHost: !!host,
    isApproved: host?.is_approved ?? false,
    isLoading,
    error,
    refetch,
  };
}
