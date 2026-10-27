import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initializeMeasurement, onMeasurementChange, startMeasurement } from '@/lib/measurement/google';

// Measurement lifecycle only. Never display an unsolicited consent prompt or
// infer consent from a visit; the existing saved consent rules remain intact.
export function MeasurementConsent() {
  const { pathname } = useLocation();
  useEffect(() => {
    initializeMeasurement();
    const refresh = () => { void startMeasurement(); };
    refresh();
    return onMeasurementChange(refresh);
  }, []);
  useEffect(() => { void startMeasurement(); }, [pathname]);
  return null;
}
