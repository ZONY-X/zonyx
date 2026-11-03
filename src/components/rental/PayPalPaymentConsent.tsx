import { Checkbox } from "@/components/ui/checkbox";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function PayPalPaymentConsent({ checked, onCheckedChange }: Props) {
  if (import.meta.env.VITE_PAYPAL_VAULT_ENABLED !== "true") return null;
  return (
    <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <span>
        Save this PayPal payment method for documented tolls, charging, excess mileage,
        and damage charges for this rental. You can revoke this consent
        from your account. ZONYX never stores raw card details.
      </span>
    </label>
  );
}
