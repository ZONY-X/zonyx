import { supabase } from "@/integrations/supabase/client";
import { parseGuestContact, type GuestDetails } from "./guestCheckoutPolicy";

// Intake only. Existing reservation access and recovery must never depend on this flag.
export const guestCheckoutEnabled = import.meta.env.VITE_GUEST_CHECKOUT_ENABLED === "true";
let pendingSession: Promise<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]> | undefined;

export async function ensureCheckoutSession() {
  const getOrCreate = async () => {
    const current = await supabase.auth.getSession();
    if (current.error) throw new Error("Your checkout session could not be restored. Please refresh before continuing.");
    if (current.data.session) return current.data.session;
    if (!guestCheckoutEnabled) return null;
    const created = await supabase.auth.signInAnonymously();
    if (created.error || !created.data.session) throw new Error("Guest checkout is temporarily unavailable. Please try again or contact support.");
    return created.data.session;
  };
  // Single flight within a tab, and a shared browser lock across tabs. The SDK
  // persists only the guest session; the entered email is never passed to Auth.
  if (!pendingSession) {
    pendingSession = (navigator.locks ? navigator.locks.request("zonyx-guest-checkout", getOrCreate) : getOrCreate())
      .finally(() => { pendingSession = undefined; });
  }
  return pendingSession;
}

export async function saveGuestDetails(details: GuestDetails, tripEnd: string) {
  const contact = parseGuestContact(details);
  if (!details.attested || !details.dateOfBirth || !details.expirationDate || details.issuingCountry.trim().length < 2 || !details.issuingRegion.trim()) throw new Error("Complete your basic driver information and self-attestation.");
  const session = await ensureCheckoutSession();
  if (!session?.user.is_anonymous) return session;
  const { error } = await supabase.functions.invoke("guest-account", { body: { action: "contact", ...contact } });
  if (error) throw new Error("Unable to save contact details. If you already reviewed an agreement, keep the same contact details or contact support.");
  const eligibility = await supabase.rpc("submit_my_driver_eligibility", {
    _legal_name: contact.fullName, _date_of_birth: details.dateOfBirth,
    _license_issuing_country: details.issuingCountry, _license_issuing_region: details.issuingRegion,
    _license_expiration_date: details.expirationDate, _attested: details.attested, _trip_end_date: tripEnd,
  });
  if (eligibility.error) throw new Error("Unable to save driver eligibility. Check your details and try again.");
  if (eligibility.data !== "eligible_self_attested") throw new Error(eligibility.data === "age_ineligible" ? "You must be at least 18 years old to book." : "Your license must remain valid through the trip end date.");
  return session;
}
