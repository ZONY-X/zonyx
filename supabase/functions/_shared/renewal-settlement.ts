import { renewalEvidence, RENEWAL_MODULE, type Session } from './renewal-checkout.ts';
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
