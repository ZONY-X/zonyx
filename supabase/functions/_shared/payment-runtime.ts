import type { DB } from "./payment-service.ts";
import { PaymentError } from "./payment-policy.ts";
import { assertSquareSandbox } from "./square-policy.ts";
import { resolvePaymentProvider, type Environment } from "./payment-adapters/registry.ts";
export const knownProcessors = ["square", "paypal", "authorize_net", "chase", "clover", "finix", "stripe"] as const;
export function processorStatuses(env: Environment) {
  return knownProcessors.map(id => {
    let status = id === "stripe" ? "Historical only" : "Not configured";
    if (id === "square" || id === "paypal") {
      const square = id === "square";
      const mode = env(square ? "SQUARE_ENVIRONMENT" : "PAYPAL_ENVIRONMENT");
      const prefix = square ? `SQUARE_${mode === "live" ? "LIVE" : "SANDBOX"}` : mode === "live" ? "PAYPAL" : "PAYPAL_SANDBOX";
      const credentials = square ? ["ACCESS_TOKEN", "LOCATION_ID", "APPLICATION_ID"] : ["CLIENT_ID", "CLIENT_SECRET"];
      if (["sandbox", "live"].includes(mode || "") && credentials.every(k => !!env(`${prefix}_${k}`))) {
        status = "Disabled";
        if (square) {
          try { assertSquareSandbox(env); status = "Ready"; } catch { /* gates remain closed */ }
        } else if (env("PAYPAL_RENTAL_CHECKOUT_ENABLED") === "true" && env("PAYPAL_PROVIDER_LOCK_READY") === "true" && env("PAYPAL_WEBHOOK_ID") && (mode !== "live" || env("PAYPAL_LIVE_RENTAL_PAYMENT_ENABLED") === "true")) status = "Ready";
      }
    }
    return { id, status, activatable: status === "Ready" };
  });
}
export async function readRuntimeConfig(db: DB) {
  const { data, error } = await db.from("payment_runtime_config").select("active_provider,version").eq("id", true).maybeSingle();
  if (error || !data) throw new PaymentError(503, "ZONYX Pay configuration unavailable. New transactions are blocked. No payment was started.");
  return data as { active_provider: string; version: number };
}
export async function runtimePaymentProvider(db: DB, env: Environment, existing?: string | null, flow: "rental" | "renewal" = "rental") {
  if (existing) return existing;
  const config = await readRuntimeConfig(db);
  if (config.active_provider === "none") throw new PaymentError(503, "ZONYX Pay has no active processor. New transactions are blocked. No payment was started.");
  if (!processorStatuses(env).some(p => p.id === config.active_provider && p.activatable)) throw new PaymentError(503, "ZONYX Pay processor is not ready. New transactions are blocked. No payment was started.");
  return resolvePaymentProvider(config.active_provider, null, flow);
}
export async function managePaymentRuntime(db: DB, env: Environment, actor: string, isAdmin: boolean, input: Record<string, unknown>) {
  if (!isAdmin) throw new PaymentError(403, "Authoritative Admin required.");
  if (input.action === "read" && Object.keys(input).every(k => k === "action")) return { ...await readRuntimeConfig(db), providers: processorStatuses(env) };
  if (input.action !== "activate" || Object.keys(input).some(k => !["action", "provider", "expectedVersion", "reason"].includes(k)) || typeof input.provider !== "string" || !Number.isSafeInteger(input.expectedVersion) || (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 500))) throw new PaymentError(400, "Invalid processor change.");
  if (input.provider !== "none" && !processorStatuses(env).some(p => p.id === input.provider && p.activatable)) throw new PaymentError(409, "Processor is not ready and cannot be activated.");
  const { data, error } = await db.rpc("set_payment_runtime_provider", { _actor: actor, _provider: input.provider, _expected_version: input.expectedVersion, _reason: input.reason || null });
  if (error) throw new PaymentError(409, "Processor change failed. Refresh ZONYX Pay and try again.");
  return { ...data, providers: processorStatuses(env) };
}
