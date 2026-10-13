import { LockKeyhole } from "lucide-react";
import logo from "@/assets/zonyx-pay-logo.png";

export function ZonyxPayBrand() {
  return (
    <div className="flex flex-col items-center gap-4">
      {/* The artwork has wide black margins; cropping is container-only and leaves the image untouched. */}
      <div className="aspect-[2172/340] w-full max-w-sm overflow-hidden">
        <img src={logo} alt="ZONYX PAY" width={2172} height={724} className="h-full w-full object-cover" />
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-300">
        <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5 text-[#0fd8c4]" /> Secure checkout
      </span>
    </div>
  );
}
