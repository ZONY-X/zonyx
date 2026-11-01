import { runtimePaymentProvider } from "./payment-runtime.ts";
import type { DB } from "./payment-service.ts";
import { PaymentError } from "./payment-policy.ts";
import { type Environment } from "./payment-adapters/registry.ts";

/** Used by direct/legacy endpoints too: a browser cannot override the active provider. */
export async function assertRentalProvider(db: DB, env: Environment, provider: string, bookingId: string) {
  const { data, error } = await db.from("booking_payments").select("provider").eq("booking_id", bookingId).maybeSingle();
  if (error) throw new PaymentError(503, "Existing payment lookup unavailable. No payment was started.");
  if ((await runtimePaymentProvider(db, env, data?.provider)) !== provider) throw new PaymentError(409, "This checkout is unavailable for this reservation. Reload ZONYX Pay or check the existing payment.");
}
