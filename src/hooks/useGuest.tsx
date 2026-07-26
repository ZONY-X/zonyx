import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

interface Guest {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  phone: string | null;
  drivers_license_number: string | null;
  drivers_license_expiry: string | null;
  date_of_birth: string | null;
  id_photo_url: string | null;
  is_verified: boolean;
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
        .from("guests")
        .select("*")
        .eq("user_id", user.id)
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
