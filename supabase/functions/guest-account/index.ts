import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleGuestAccount } from "../_shared/guest-account.ts";

serve(request => handleGuestAccount(request, {
  env: name => Deno.env.get(name),
  client: authorization => createClient(Deno.env.get("SUPABASE_URL")!,
    Deno.env.get(authorization ? "SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(authorization ? { global: { headers: { Authorization: authorization } } } : {}),
    }),
}));
