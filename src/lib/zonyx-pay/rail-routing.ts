/** ZONYX Pay is the first-party payment platform; external acquiring rails remain replaceable. */
export const PAYMENT_PLATFORM = "zonyx-pay" as const;
export type Rail = { provider: string; enabled: boolean; eligible: boolean };
/** Preview helper only. Server payment-routing is authoritative; never fall back. */
export function selectAcquiringRail(rails: readonly Rail[], existing?: string | null, active = "square"): string {
  const provider = existing || active;
  const rail = rails.find(r => r.provider === provider);
  if (!rail?.enabled || !rail.eligible) throw new Error(existing
    ? "Existing payment rail unavailable; reconcile before proceeding."
    : "No acquiring rail available; no payment was started.");
  return provider;
}
