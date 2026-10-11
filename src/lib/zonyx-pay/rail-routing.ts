/** ZONYX Pay is the first-party payment platform; external acquiring rails remain replaceable. */
export const PAYMENT_PLATFORM = "zonyx-pay" as const;
export const DEFAULT_RAIL_PRIORITY = ["square", "paypal"] as const;
export type Rail = { provider: string; enabled: boolean; eligible: boolean };
/** Select only before the booking has any financial operation. Never silently reroute an existing payment. */
export function selectAcquiringRail(rails: readonly Rail[], existing?: string | null): string {
  if (existing) {
    const rail = rails.find(r => r.provider === existing);
    if (!rail?.enabled || !rail.eligible) {
      throw new Error("Existing payment rail unavailable; reconcile before proceeding.");
    }
    return existing;
  }
  const eligible = rails.filter(r => r.enabled && r.eligible);
  const rank = (id: string) => {
    const index = DEFAULT_RAIL_PRIORITY.indexOf(id as typeof DEFAULT_RAIL_PRIORITY[number]);
    return index === -1 ? DEFAULT_RAIL_PRIORITY.length : index;
  };
  const chosen = eligible.sort((a,b) => rank(a.provider)-rank(b.provider))[0];
  if (!chosen) throw new Error("No acquiring rail available; no payment was started.");
  return chosen.provider;
}
