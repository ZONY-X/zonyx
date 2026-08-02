import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

interface Guest {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  email: string;
  is_host: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export function useGuest() {
  const { user } = useAuth();

  const { data: guest, isLoading: guestLoading, refetch } = useQuery({
    queryKey: ["guest", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_host", false)
        .maybeSingle();

      if (error) {
        console.error("Error fetching guest:", error);
        return null;
      }
      
      return data as Guest | null;
    },
    enabled: !!user?.id,
  });

  const isGuest = !!guest;

  return {
    guest,
    isGuest,
    guestLoading,
    refetch,
  };
}
