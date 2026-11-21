import { Input } from "@/components/ui/input";
import type { GuestDetails } from "@/lib/guestCheckoutPolicy";

export function GuestCheckoutDetails({ value, onChange }: { value: GuestDetails; onChange: (v: GuestDetails) => void }) {
  const fields = [
    ["fullName", "Full legal name", "text", "name"], ["email", "Email for your booking", "email", "email"],
    ["phone", "Contact phone", "tel", "tel"], ["dateOfBirth", "Date of birth", "date", "bday"],
    ["issuingCountry", "License issuing country", "text", "country-name"],
    ["issuingRegion", "License issuing state/region", "text", "address-level1"],
    ["expirationDate", "License expiration", "date", "off"],
  ] as const;
  return <div className="mt-6 space-y-4 rounded-2xl border border-border bg-background/70 p-4">
    <h3 className="font-medium">Your driver and contact details</h3>
    <p className="text-sm text-muted-foreground">No account or password needed to book. We’ll automatically create your ZONYX account after confirmation and email a secure access link. You can choose a password later.</p>
    {fields.map(([key, label, type, autoComplete]) => <label key={key} className="block space-y-2 text-sm"><span>{label}</span><Input required type={type} autoComplete={autoComplete} maxLength={key === "email" ? 254 : 150} value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })} /></label>)}
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={value.attested} onChange={e => onChange({ ...value, attested: e.target.checked })} className="mt-1 accent-primary" /><span>I attest that these details are accurate and I am legally eligible to drive.</span></label>
    <p className="text-sm text-muted-foreground">Identity and license verification must be completed before vehicle handover.</p>
  </div>;
}
