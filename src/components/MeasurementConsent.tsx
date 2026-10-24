import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { initializeMeasurement, measurementConfigured, onMeasurementChange, readMeasurementChoice, readAdvertisingChoice, setMeasurementChoice, startMeasurement, type MeasurementChoice } from '@/lib/measurement/google';

export function MeasurementConsent() {
  const { pathname } = useLocation();
  const [choice, setChoice] = useState(readMeasurementChoice);
  const [open, setOpen] = useState(false);
  const [advertising, setAdvertising] = useState(readAdvertisingChoice);
  useEffect(() => {
    initializeMeasurement();
    const refresh = () => { setChoice(readMeasurementChoice()); void startMeasurement(); };
    refresh();
    return onMeasurementChange(refresh);
  }, []);
  useEffect(() => { void startMeasurement(); }, [pathname]);
  if (!measurementConfigured) return null;
  const save = (next: MeasurementChoice) => { setMeasurementChoice(next, next === 'granted' && advertising); setChoice(next); setAdvertising(readAdvertisingChoice()); setOpen(false); };
  if (choice && !open) return <button type="button" onClick={() => setOpen(true)} className="fixed bottom-16 left-3 z-40 rounded border border-white/20 bg-black px-3 py-2 text-xs text-white sm:bottom-3">Measurement preferences</button>;
  return <section aria-label="Measurement preferences" className="fixed inset-x-3 bottom-16 z-50 mx-auto max-w-xl rounded-xl border border-white/20 bg-[#090d0e] p-5 text-sm text-white shadow-xl sm:bottom-4">
    <p>Allow Google Analytics cookies to help ZONYX measure website visits and confirmed bookings? Optional measurement does not affect your reservation or payment.</p>
    <label className="mt-3 flex items-start gap-3"><input type="checkbox" checked={advertising} onChange={event => setAdvertising(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#0fd8c4]" /><span>Also allow Google Ads conversion measurement. Ad personalization remains off.</span></label>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" onClick={() => save('denied')} className="rounded-lg border border-white/40 px-4 py-3">Only necessary</button>
      <button type="button" onClick={() => save('granted')} className="rounded-lg bg-[#0fd8c4] px-4 py-3 font-semibold text-black">Allow measurement</button>
    </div>
  </section>;
}
