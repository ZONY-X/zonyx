import { runtimePaymentProvider } from "./payment-runtime.ts";
import type { DB } from "./payment-service.ts";
import { PaymentError } from "./payment-policy.ts";
import { type Environment } from "./payment-adapters/registry.ts";

/** Existing links, attempts and saved authorizations remain on their original rail. */
export async function ensureRenewalPaymentLink(db: DB, env: Environment, periodId: string) {
  const legacy = await db.from("renewal_checkout_attempts").select("id").eq("period_id", periodId).limit(1).maybeSingle();
  const stored = await db.from("rental_renewal_payment_attempts").select("id").eq("period_id", periodId).limit(1).maybeSingle();
  const square = await db.from("square_renewal_payment_attempts").select("id").eq("period_id", periodId).limit(1).maybeSingle();
  const link = await db.from("square_renewal_payment_links").select("token,enabled").eq("period_id", periodId).maybeSingle();
  if (legacy.error || stored.error || square.error || link.error) throw new PaymentError(503, "Existing renewal lookup unavailable. No payment was started.");
  if (legacy.data || stored.data) throw new PaymentError(409, "Your existing renewal payment requires support. No new payment was started.");
  if (link.data) {
    if (!link.data.enabled) throw new PaymentError(409, "This payment link is unavailable.");
    return link.data.token as string;
  }
  const provider = await runtimePaymentProvider(db, env, square.data ? "square" : null, "renewal");
  if (provider !== "square") throw new PaymentError(503, "Secure renewal checkout is awaiting activation.");
  const { data, error } = await db.rpc("ensure_square_renewal_link", { _period_id: periodId });
  if (error || !data) throw new PaymentError(503, "Public payment link unavailable.");
  return data as string;
}
