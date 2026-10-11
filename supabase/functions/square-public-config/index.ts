import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
let cached: { locationId: string; expires: number } | undefined;
serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  // This endpoint can never dispatch financial actions, even if payment gates change.
  if (request.method !== "GET") return json(405, { error: "Method not allowed." });
  let keys: string[] = [];
  try { keys = Object.values(JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}")); } catch { /* Fail closed on malformed runtime configuration. */ }
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (anonKey) keys.push(anonKey);
  if (!keys.includes(request.headers.get("apikey") || "") || !request.headers.get("apikey")) return json(401, { error: "Invalid storefront key." });
  const applicationId = Deno.env.get("SQUARE_LIVE_APPLICATION_ID");
  const token = Deno.env.get("SQUARE_LIVE_ACCESS_TOKEN");
  if (Deno.env.get("SUPABASE_URL") !== "https://fazzuetfwwfiqehpnjky.supabase.co" || Deno.env.get("SQUARE_INSTALLED") !== "true" || Deno.env.get("SQUARE_ENVIRONMENT") !== "live" || !applicationId?.startsWith("sq0idp-") || !token) return json(503, { error: "Square connection is unavailable." });
  try {
    if (!cached || cached.expires < Date.now()) {
      const response = await fetch("https://connect.squareup.com/v2/locations", { method: "GET", headers: { Authorization: `Bearer ${token}`, "Square-Version": "2026-09-16" }, redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      const configured = Deno.env.get("SQUARE_LIVE_LOCATION_ID");
      const location = data.locations?.find((item: { id: string; status: string; currency: string }) => item.status === "ACTIVE" && item.currency === "USD" && (!configured || item.id === configured));
      if (!location?.id) throw new Error();
      cached = { locationId: location.id, expires: Date.now() + 60000 };
    }
    return json(200, { provider: "square", environment: "live", applicationId, locationId: cached.locationId, paymentsEnabled: false, depositMaximumDays: 7, depositCaptureEnabled: false, separateDepositProcedureRequiredForLongCoverage: true });
  } catch { return json(503, { error: "Square connection is unavailable. No payment was started." }); }
});
