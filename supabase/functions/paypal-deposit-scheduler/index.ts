import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

function env(name: string) {
  return Deno.env.get(name) || "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST" ||
      !env("PAYPAL_DEPOSIT_SCHEDULER_SECRET") ||
      request.headers.get("x-zonyx-scheduler-secret") !== env("PAYPAL_DEPOSIT_SCHEDULER_SECRET")) {
    return new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers });
  }

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();
  const { data: due, error } = await db
    .from("booking_security_deposits")
    .select("rental_payment_id,authorization_due_at,operation_state")
    .eq("provider", "paypal")
    .not("authorization_due_at", "is", null)
    .lte("authorization_due_at", now)
    .neq("status", "authorized")
    .in("operation_state", ["idle", "awaiting_approval", "reconciliation_required"])
    .limit(50);
  if (error) {
    return new Response(JSON.stringify({ error: "Unable to load due deposits." }), { status: 500, headers });
  }

  const endpoint = `${env("SUPABASE_URL")}/functions/v1/paypal-deposit`;
  const results: Array<{ paymentId: string; status: number }> = [];
  for (const row of due || []) {
    if (!row.rental_payment_id) continue;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-zonyx-scheduler-secret": env("PAYPAL_DEPOSIT_SCHEDULER_SECRET"),
        },
        body: JSON.stringify({
          action: "auto-authorize",
          paymentId: row.rental_payment_id,
        }),
      });
      results.push({ paymentId: row.rental_payment_id, status: response.status });
    } catch {
      results.push({ paymentId: row.rental_payment_id, status: 503 });
    }
  }
  return new Response(JSON.stringify({ processed: results.length, results }), { status: 200, headers });
});
