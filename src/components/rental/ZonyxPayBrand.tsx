import { LockKeyhole } from "lucide-react";
import fallbackLogo from "@/assets/zonyx-official-logo.png";

// Dropping the approved artwork at src/assets/zonyx-pay-logo.(png|svg|webp) replaces the fallback with no code change.
const approved = Object.values(import.meta.glob<string>("../../assets/zonyx-pay-logo.{png,svg,webp}", { eager: true, import: "default" }))[0];

export function ZonyxPayBrand() {
  return (
    <div className="flex items-center justify-between gap-4">
      <img src={approved ?? fallbackLogo} alt="ZONYX PAY" className="h-11 w-auto max-w-[58%] object-contain object-left sm:h-12" />
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300">
        <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5 text-[#22d3c5]" /> Secure checkout
      </span>
    </div>
  );
}
