import { planBookingCancellation, derivePaymentState } from './cancellation-refund.ts';

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const base = {
  bookingId: '00000000-0000-0000-0000-000000000001',
  actorRole: 'guest',
  actorProfileId: '00000000-0000-0000-0000-0000000000c1',
  cancelType: 'guest',
  tripStatus: 'confirmed',
  subtotalCents: 80000,
  serviceFeeCents: 15000,
  taxesCents: 7000,
  grandTotalCents: 102000,
  hasRefundablePayment: true,
  hasCheckoutSession: true,
};

// Eligibility
check('guest can cancel confirmed booking with refund', planBookingCancellation(base).ok, true);
check('already-cancelled rejected', planBookingCancellation({ ...base, tripStatus: 'cancelled' }).ok, false);
check('active trip rejected', planBookingCancellation({ ...base, tripStatus: 'active' }).ok, false);
check('pending_inspection rejected', planBookingCancellation({ ...base, tripStatus: 'pending_inspection' }).ok, false);
check('completed trip rejected', planBookingCancellation({ ...base, tripStatus: 'completed' }).ok, false);

// ZONYX refundable-component rules
check('guest refund excludes service fee', planBookingCancellation(base).refundCents, 87000);
check('guest nonRefundable = service fee', planBookingCancellation(base).nonRefundableCents, 15000);

// pending_payment cancels without refund
check('pending_payment cancels without refund', planBookingCancellation({
  ...base, tripStatus: 'pending_payment', hasCheckoutSession: false,
}), { ok: true, action: 'cancel_without_refund', refundCents: 0, nonRefundableCents: 0 });

// Host/provider = full refund
check('host cancellation full refund', planBookingCancellation({
  ...base, actorRole: 'host', cancelType: 'host_provider',
}), { ok: true, action: 'cancel_with_refund', refundCents: 102000, nonRefundableCents: 0 });

// Authorization
check('unverified payment rejected before state change', planBookingCancellation({
  ...base, hasCheckoutSession: false,
}).ok, false);
check('paid but unverifiable payment rejected', planBookingCancellation({
  ...base, hasRefundablePayment: false,
}).ok, false);

// Payment-state derivation
check('derivePaymentState: confirmed + session = paid', derivePaymentState({ tripStatus: 'confirmed', grandTotalCents: 102000, hasCheckoutSession: true }), 'paid');
check('derivePaymentState: pending_payment = pending', derivePaymentState({ tripStatus: 'pending_payment', grandTotalCents: 102000, hasCheckoutSession: false }), 'pending');
check('derivePaymentState: confirmed + no session = unverified', derivePaymentState({ tripStatus: 'confirmed', grandTotalCents: 102000, hasCheckoutSession: false }), 'unverified');

// Boundary
check('zero-fee booking full guest refund', planBookingCancellation({
  ...base, serviceFeeCents: 0, grandTotalCents: 87000,
}).refundCents, 87000);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
