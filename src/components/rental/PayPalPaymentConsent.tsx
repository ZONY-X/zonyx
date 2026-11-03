import { Checkbox } from "@/components/ui/checkbox";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function PayPalPaymentConsent({ checked, onCheckedChange }: Props) {
  return (
    <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <span>
        I authorize ZONYX to save this PayPal payment method for this rental and to
        charge documented, contractually authorized expenses such as additional
        mileage, tolls, late returns, fuel or charging, and documented damages.
        You can revoke this consent from your account. ZONYX never stores raw card
        details.
      </span>
    </label>
  );
}
