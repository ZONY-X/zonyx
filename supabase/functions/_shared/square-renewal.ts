import { validateSquarePayment, type SquarePayment } from './square-policy.ts';
export type RenewalAttempt = { id: string; period_id: string; amount_cents: number; location_id: string; environment: string; provider_payment_id: string | null; created_at: string; state: string; dispatch?: boolean; already_paid?: boolean };
export function squareRenewalEvidence(payment: SquarePayment, attempt: RenewalAttempt) {
 validateSquarePayment(payment, {id: attempt.provider_payment_id, reference: attempt.id, location: attempt.location_id, amount: attempt.amount_cents, hold: false});
 if (!['COMPLETED','PENDING','APPROVED','FAILED','CANCELED'].includes(payment.status)) throw new Error('Unknown Square renewal status. Check the existing payment.');
 return { _attempt_id: attempt.id, _payment_id: payment.id, _amount_cents: attempt.amount_cents, _location_id: attempt.location_id, _environment: attempt.environment, _status: payment.status };
}
