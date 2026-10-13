import { RENEWAL_MODULE } from './renewal-checkout.ts';
export type RenewalAttempt = { attempt_id: string; period_id: string; amount_cents: number; currency: string; livemode: boolean; idempotency_key: string; reservation_number: string; period_start: string; period_end: string; guest_email: string; created_at: string };
export type Session = { id: string; mode?: string; status?: string; payment_status?: string; amount_total?: number | null; currency?: string | null; livemode?: boolean; metadata?: Record<string, string> | null; client_reference_id?: string | null; payment_intent?: string | { id: string; status?: string; amount_received?: number; currency?: string; metadata?: Record<string, string> | null; capture_method?: string } | null };
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

// Shared by the signed webhook and the authenticated return/status check.
type Attempt = { id: string; period_id: string; amount_cents: number; currency: string; livemode: boolean };
type Service = { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { single: () => Promise<{ data: Attempt | null; error: unknown }> } } }; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: Record<string, unknown> | null; error: unknown }> };
type Stripe = { checkout: { sessions: { retrieve: (id: string, options: { expand: string[] }) => Promise<Session> } } };
export async function settleRenewalSession(service: Service, stripe: Stripe, sessionId: string, eventType?: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  if (session.metadata?.zonyxFlow !== RENEWAL_MODULE) throw new Error('Not a renewal Checkout Session.');
  const { data: attempt, error } = await service.from('renewal_checkout_attempts').select('*').eq('stripe_session_id', session.id).single();
  if (error || !attempt) throw new Error('Renewal session is not linked to its attempt.');
  const result = renewalEvidence(session, { ...attempt, attempt_id: attempt.id }, eventType);
  if (result.status === 'open') return { state: 'open', periodId: attempt.period_id };
  const { data, error: failure } = await service.rpc('record_guest_renewal_evidence', { _attempt_id: attempt.id, _session_id: session.id, _payment_intent_id: result.paymentIntentId, _amount_cents: attempt.amount_cents, _currency: attempt.currency, _livemode: attempt.livemode, _status: result.status });
  if (failure) throw failure;
  return { ...data, state: result.status, periodId: attempt.period_id };
}
