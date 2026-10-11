import { ShieldCheck, CreditCard, LockKeyhole } from "lucide-react";

type Props = { title: string; description: string; bookingId?: string };

export function ZonyxPayHeader({ title, description, bookingId }: Props) {
  return (
    <header className="space-y-5" aria-label="ZONYX Pay secure checkout">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">ZONYX</p>
          <p className="text-2xl font-bold tracking-tight">PAY<span className="text-primary">.</span></p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium">
          <LockKeyhole aria-hidden="true" className="h-4 w-4" /> Secure checkout
        </span>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {bookingId && <p className="mt-2 text-xs text-muted-foreground">Booking reference: {bookingId}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" /> Deposit authorization, not a charge</span>
        <span className="flex items-center gap-2"><CreditCard aria-hidden="true" className="h-4 w-4 shrink-0" /> Encrypted processor-hosted card fields</span>
      </div>
    </header>
  );
}
