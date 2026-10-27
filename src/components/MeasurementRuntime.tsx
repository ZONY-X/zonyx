import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initializeMeasurement, onMeasurementChange, startMeasurement } from '@/lib/measurement/google';

// Headless measurement lifecycle; regional policy and existing refusals are
// resolved by the measurement module without changing the booking interface.
export function MeasurementRuntime() {
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
