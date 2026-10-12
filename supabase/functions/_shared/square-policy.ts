import { PaymentError } from "./payment-policy.ts";
export type SquareEnv = (name: string) => string | undefined;
export function squareSetting(env: SquareEnv, suffix: string) {
  return env(`SQUARE_${env("SQUARE_ENVIRONMENT") === "live" ? "LIVE" : "SANDBOX"}_${suffix}`);
}
// Both environments fail closed before credentials, database or provider access.
// Retain the export name for the existing sandbox contract fixtures.
export function assertSquareSandbox(env: SquareEnv, gate = "SQUARE_CHECKOUT_ENABLED") {
  if (env(gate) !== "true" ||
      env("SQUARE_PROVIDER_LOCK_READY") !== "true") throw new PaymentError(503, "Square is pending verified activation. No payment was started.");
  if (env("SQUARE_ENVIRONMENT") === "live") {
    if (env("SUPABASE_URL") !== "https://fazzuetfwwfiqehpnjky.supabase.co")
      throw new PaymentError(503, "Square live checkout requires the designated production project.");
    return;
  }
  if (env("SQUARE_ENVIRONMENT") !== "sandbox" || env("SQUARE_SANDBOX_PROJECT_URL") !== env("SUPABASE_URL") ||
      !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env("SUPABASE_URL") || "") ||
      env("SUPABASE_URL") !== "https://pvowzjqimikcoyjwclez.supabase.co") {
    throw new PaymentError(503, "Square is restricted to the designated sandbox project.");
  }
}
export function assertSquareCoverage(deadline: string, now = Date.now()) {
  const end = Date.parse(deadline);
  // One hour safety margin; advance bookings are included in the seven-day limit.
  if (!Number.isFinite(end) || end <= now || end > now + 167 * 3600000)
    throw new PaymentError(409, "Deposit coverage cannot protect this rental through inspection. No rental payment was started.");
}
export function squareDepositTiming(deadline: string, now = Date.now()) {
  const end=Date.parse(deadline);
  if(!Number.isFinite(end) || end<=now) throw new PaymentError(409,"Reservation inspection window has ended.");
  const opens=end-167*3600000;
  return {depositDeferred:opens>now,depositAuthorizationAvailableAt:new Date(Math.max(opens,now)).toISOString()};
}
export type SquarePayment = {
  id: string; reference_id: string; location_id: string; status: string;
  source_type: string; amount_money: { amount: number; currency: string };
  refunded_money?: { amount: number; currency: string };
  approved_money?: { amount: number; currency: string };
  total_money?: { amount: number; currency: string };
  delayed_until?: string; delay_action?: string; created_at?: string;
};
export function validateSquarePayment(p: SquarePayment, expected: { id?: string | null; reference: string; location: string; amount: number; hold: boolean }) {
  if (!p || !p.id || (expected.id && p.id !== expected.id) || p.reference_id !== expected.reference ||
      p.location_id !== expected.location || p.source_type !== "CARD" ||
      p.amount_money?.currency !== "USD" || p.amount_money.amount !== expected.amount ||
      !Number.isSafeInteger(p.amount_money.amount) || expected.amount <= 0 ||
      (p.total_money && (p.total_money.amount !== expected.amount || p.total_money.currency !== "USD")) ||
      (p.approved_money && (p.approved_money.currency !== "USD" ||
        (p.approved_money.amount !== expected.amount && !(["FAILED", "CANCELED"].includes(p.status) && p.approved_money.amount === 0))))) {
    throw new PaymentError(409, "Square payment identity or amount requires reconciliation.");
  }
  if (expected.hold && p.status === "APPROVED" && (p.delay_action !== "CANCEL" || !Number.isFinite(Date.parse(p.delayed_until || ""))))
    throw new PaymentError(409, "Square deposit must automatically void, never capture.");
  if (expected.hold && p.status === "COMPLETED") throw new PaymentError(409, "Unexpected deposit capture requires reconciliation.");
  return p;
}
export async function verifySquareSignature(body: string, signature: string, key: string, url: string) {
  if (!key || !url || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const encoder = new TextEncoder();
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(url + body)));
  const supplied = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  let difference = digest.length ^ supplied.length;
  for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ (supplied[i] ?? 0);
  return difference === 0;
}
