import { Link } from 'react-router-dom';
import { PHONE_HREF, PHONE_LABEL, rentalQuestions } from '@/lib/seoContent.mjs';

export function RentalContact({ vehicle, compact = false }: { vehicle?: string; compact?: boolean }) {
  return <div className={compact ? 'mt-5 space-y-3' : 'border-t border-white/10 py-8'}>
    <p className="text-sm leading-6 text-white/70">{vehicle ? `Questions about the ${vehicle}?` : 'Prefer to speak with our Miami team?'}</p>
    <a href={PHONE_HREF} className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/25 px-6 text-sm font-semibold text-white transition-colors hover:border-[hsl(var(--home-teal))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">Call to reserve · {PHONE_LABEL}</a>
    <p className="text-xs leading-5 text-white/55">Speak with ZONYX about dates and rental requirements. <Link to="/contact" className="underline underline-offset-4">More contact options</Link></p>
  </div>;
}
export function RentalQuestions() {
  return <section className="mt-12 border-t border-white/10 pt-8"><h2 className="font-display text-2xl text-white">Before you reserve</h2>{rentalQuestions.map(([q, a]) => <details key={q} className="border-b border-white/10 py-5"><summary className="cursor-pointer text-sm font-medium text-white">{q}</summary><p className="mt-3 max-w-3xl text-sm leading-7 text-white/65">{a}</p></details>)}<p className="mt-5 text-sm text-white/60"><Link to="/driver-eligibility" className="underline">Driver eligibility</Link> · <Link to="/house-rules" className="underline">House rules</Link> · <Link to="/terms" className="underline">Terms</Link> · <Link to="/long-term-rentals" className="underline">Long-term rental inquiries</Link></p></section>;
}
