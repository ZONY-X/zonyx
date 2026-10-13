import { ZonyxPayBrand } from "@/components/rental/ZonyxPayBrand";

type Props = { title: string; description?: string; bookingId?: string };

export function ZonyxPayHeader({ title }: Props) {
  return (
    <header className="space-y-6" aria-label="ZONYX Pay secure checkout">
      <ZonyxPayBrand />
      <div className="h-px bg-white/10" />
      <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
    </header>
  );
}
