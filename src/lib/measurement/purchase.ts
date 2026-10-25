export type VerifiedPurchase = { transaction_id: string; value: number; currency: string; paidAt: string };
const HANDOFF = 'zonyx:confirmed-checkout:v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
export function armConfirmedCheckout(bookingId: string) {
  try { sessionStorage.setItem(HANDOFF, JSON.stringify({ bookingId, at: Date.now() })); } catch { /* Measurement must never block checkout. */ }
}
export function isPurchaseEligible(bookingId: string, purchase: VerifiedPurchase, now = Date.now()) {
  try {
    const handoff = JSON.parse(sessionStorage.getItem(HANDOFF) || 'null');
    const paidAt = Date.parse(purchase.paidAt);
    return handoff?.bookingId === bookingId && Number.isFinite(handoff.at) && handoff.at <= now && now - handoff.at < MAX_AGE
      && Number.isFinite(paidAt) && paidAt <= now && now - paidAt < MAX_AGE
      && /^zonyx_square_[0-9a-f-]{36}$/i.test(purchase.transaction_id)
      && Number.isFinite(purchase.value) && purchase.value > 0 && /^[A-Z]{3}$/.test(purchase.currency);
  } catch { return false; }
}
export function purchaseKey(destination: string, purchase: VerifiedPurchase) {
  return `zonyx:purchase:v1:${destination}:${purchase.transaction_id}`;
}
