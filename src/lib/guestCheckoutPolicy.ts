// Shared validation only. Contact email is never an authentication claim.
export type GuestDetails = {
  fullName: string; email: string; phone: string; dateOfBirth: string;
  issuingCountry: string; issuingRegion: string; expirationDate: string; attested: boolean;
};
export const emptyGuestDetails: GuestDetails = {
  fullName: "", email: "", phone: "", dateOfBirth: "", issuingCountry: "",
  issuingRegion: "", expirationDate: "", attested: false,
};
export function parseGuestContact(input: unknown) {
  const v = input as Record<string, unknown> | null;
  if (!v || typeof v.fullName !== "string" || typeof v.email !== "string" || typeof v.phone !== "string") throw new Error("Enter your name, email and phone number.");
  const fullName = v.fullName.trim(), email = v.email.trim().toLowerCase(), phone = v.phone.trim();
  if (fullName.length < 2 || fullName.length > 150 || [...fullName].some(char => char.charCodeAt(0) < 32)) throw new Error("Enter your full legal name.");
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!/^[+()\d .-]{7,32}$/.test(phone)) throw new Error("Enter a valid contact phone number.");
  return { fullName, email, phone };
}
