import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initializeMeasurement, onMeasurementChange, startMeasurement, trackContactIntent } from '@/lib/measurement/google';

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
  useEffect(() => {
    const onContact = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const href = anchor?.getAttribute('href') || '';
      if (href.startsWith('tel:')) void trackContactIntent('phone_click');
      else if (/^https:\/\/wa\.me\//.test(href)) void trackContactIntent('whatsapp_click');
    };
    document.addEventListener('click', onContact);
    return () => document.removeEventListener('click', onContact);
  }, []);
  useEffect(() => {
    if (!/^\/(?:booking(?:\/|$)|auth$|reset-password$|(?:admin|host|guest|operations)-dashboard$|dashboard$|operations\/|trip\/|partners\/dashboard$)/.test(pathname)) return;
    const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previous = existing?.content;
    const robots = existing || document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, follow';
    if (!existing) document.head.appendChild(robots);
    return () => { if (existing) robots.content = previous || ''; else robots.remove(); };
  }, [pathname]);
  return null;
}
