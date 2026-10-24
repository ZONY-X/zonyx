import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { initializeMeasurement, measurementConfigured, onMeasurementChange, readMeasurementChoice, setMeasurementChoice, startMeasurement, type MeasurementChoice } from '@/lib/measurement/google';

export function MeasurementConsent() {
  const { pathname } = useLocation();
  const [choice, setChoice] = useState(readMeasurementChoice);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    initializeMeasurement();
    const refresh = () => { setChoice(readMeasurementChoice()); void startMeasurement(); };
    refresh();
    return onMeasurementChange(refresh);
  }, []);
  useEffect(() => { void startMeasurement(); }, [pathname]);
  if (!measurementConfigured) return null;
  const save = (next: MeasurementChoice) => { setMeasurementChoice(next); setChoice(next); setOpen(false); };
  if (choice && !open) return <button type="button" onClick={() => setOpen(true)} className="fixed bottom-16 left-3 z-40 rounded border border-white/20 bg-black px-3 py-2 text-xs text-white sm:bottom-3">Measurement preferences</button>;
  return <section aria-label="Measurement preferences" className="fixed inset-x-3 bottom-16 z-50 mx-auto max-w-xl rounded-xl border border-white/20 bg-[#090d0e] p-5 text-sm text-white shadow-xl sm:bottom-4">
    <p>Allow Google measurement cookies to help ZONYX measure bookings and advertising? Optional measurement does not affect your reservation or payment.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" onClick={() => save('denied')} className="rounded-lg border border-white/40 px-4 py-3">Only necessary</button>
      <button type="button" onClick={() => save('granted')} className="rounded-lg bg-[#0fd8c4] px-4 py-3 font-semibold text-black">Allow measurement</button>
    </div>
  </section>;
}
