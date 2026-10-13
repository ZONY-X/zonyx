export const RENEWAL_MODULE = 'zonyx_guest_renewal_v1';
export const RENEWAL_ORIGIN = 'https://www.gozonyx.com';
export type RenewalAttempt = { attempt_id: string; period_id: string; amount_cents: number; currency: string; livemode: boolean; idempotency_key: string; reservation_number: string; period_start: string; period_end: string; guest_email: string; created_at: string };
export type Session = { id: string; mode?: string; status?: string; payment_status?: string; amount_total?: number | null; currency?: string | null; livemode?: boolean; metadata?: Record<string, string> | null; client_reference_id?: string | null; payment_intent?: string | { id: string; status?: string; amount_received?: number; currency?: string; metadata?: Record<string, string> | null; capture_method?: string } | null };
export function renewalCheckoutParams(a: RenewalAttempt) {
  if (!Number.isSafeInteger(a.amount_cents) || a.amount_cents < 50 || a.currency !== 'usd') throw new Error('Invalid renewal price.');
  const url = `${RENEWAL_ORIGIN}/booking/renewal?periodId=${encodeURIComponent(a.period_id)}`;
  const metadata = { zonyxFlow: RENEWAL_MODULE, renewalPeriodId: a.period_id, renewalAttemptId: a.attempt_id };
  return { mode: 'payment' as const, allowed_payment_method_types: ['card'], success_url: `${url}&return=success`, cancel_url: `${url}&return=cancel`, client_reference_id: a.attempt_id, customer_email: a.guest_email, metadata, payment_intent_data: { metadata, description: `ZONYX renewal ${a.reservation_number}: ${a.period_start} → ${a.period_end}` }, line_items: [{ quantity: 1, price_data: { currency: a.currency, unit_amount: a.amount_cents, product_data: { name: `ZONYX rental renewal — ${a.reservation_number}`, description: `${a.period_start} → ${a.period_end}. Renewal only; original rental and security deposit are separate.` } } }], integration_identifier: 'zonyx_renewal_v1_qmrbnxtk' };
}
export function renewalEvidence(session: Session, a: Pick<RenewalAttempt, 'attempt_id' | 'period_id' | 'amount_cents' | 'currency' | 'livemode'>, eventType?: string) {
  if (session.id === '' || session.mode !== 'payment' || session.metadata?.zonyxFlow !== RENEWAL_MODULE || session.metadata?.renewalPeriodId !== a.period_id || session.metadata?.renewalAttemptId !== a.attempt_id || session.client_reference_id !== a.attempt_id || session.amount_total !== a.amount_cents || session.currency !== a.currency || session.livemode !== a.livemode) throw new Error('Renewal Checkout identity or amount conflicts.');
  if (session.payment_status === 'paid') {
    const pi = session.payment_intent;
    if (!pi || typeof pi === 'string' || pi.status !== 'succeeded' || pi.amount_received !== a.amount_cents || pi.currency !== a.currency || pi.capture_method !== 'automatic' || pi.metadata?.zonyxFlow !== RENEWAL_MODULE || pi.metadata?.renewalPeriodId !== a.period_id || pi.metadata?.renewalAttemptId !== a.attempt_id || session.status !== 'complete') throw new Error('Confirmed renewal PaymentIntent evidence required.');
    return { status: 'paid', paymentIntentId: pi.id };
  }
  if (session.status === 'expired') return { status: 'expired', paymentIntentId: null };
  if (eventType === 'checkout.session.async_payment_failed') return { status: 'failed', paymentIntentId: null };
  if (session.status === 'complete') return { status: 'processing', paymentIntentId: null };
  return { status: 'open', paymentIntentId: null };
}
export type RenewalPreview = { scope: 'renewal-preview'; exp: number; period_id: string; reservation_number: string; period_start: string; period_end: string; amount_cents: number; currency: string };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
async function previewKey(secret: string) { return crypto.subtle.importKey('raw', new TextEncoder().encode(`zonyx-renewal-preview:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function signRenewalPreview(data: RenewalPreview, secret: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify(data)));
  const signature = await crypto.subtle.sign('HMAC', await previewKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyRenewalPreview(token: string, secret: string): Promise<RenewalPreview> {
  const parts = token.split('.');
  if (parts.length !== 2 || token.length > 3000 || !await crypto.subtle.verify('HMAC', await previewKey(secret), decode(parts[1]), new TextEncoder().encode(parts[0]))) throw new Error('Invalid preview link.');
  const data = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as RenewalPreview;
  if (data.scope !== 'renewal-preview' || data.exp <= Date.now() || !Number.isSafeInteger(data.amount_cents) || data.currency !== 'usd') throw new Error('Preview link expired or invalid.');
  return data;
}
