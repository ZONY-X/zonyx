import { isPurchaseEligible, purchaseKey, type VerifiedPurchase } from './purchase';
export type MeasurementChoice = 'granted' | 'denied';
const STORAGE = 'zonyx:google-consent:v1';
const CHANGE = 'zonyx:measurement-consent';
// Enable only after the existing GA4 stream's automatic/enhanced measurement
// is disabled: send_page_view:false alone does not disable history events.
const ga4 = import.meta.env.VITE_GA4_MANUAL_EVENTS_READY === 'true' && /^G-[A-Z0-9]+$/.test(import.meta.env.VITE_GA4_MEASUREMENT_ID || '') ? import.meta.env.VITE_GA4_MEASUREMENT_ID as string : '';
const ads = /^AW-\d+$/.test(import.meta.env.VITE_GOOGLE_ADS_CONVERSION_ID || '') ? import.meta.env.VITE_GOOGLE_ADS_CONVERSION_ID as string : '';
const label = /^[A-Za-z0-9_-]+$/.test(import.meta.env.VITE_GOOGLE_ADS_CONVERSION_LABEL || '') ? import.meta.env.VITE_GOOGLE_ADS_CONVERSION_LABEL as string : '';
export const measurementConfigured = Boolean(ga4 || (ads && label));
const denied = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
let initialized = false;
let tag: Promise<void> | undefined;
const emitted = new Set<string>();
declare global { interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } }
export function readMeasurementChoice(): MeasurementChoice | null {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null'); return saved?.expires > Date.now() && ['granted', 'denied'].includes(saved.choice) ? saved.choice : null; } catch { return null; }
}
export function readAdvertisingChoice(): boolean {
  if (readMeasurementChoice() !== 'granted') return false;
  try { return JSON.parse(localStorage.getItem(STORAGE) || 'null')?.advertising === true; } catch { return false; }
}
function currentConsent() {
  if (readMeasurementChoice() !== 'granted') return denied;
  const advertising = readAdvertisingChoice() ? 'granted' : 'denied';
  return { analytics_storage: 'granted', ad_storage: advertising, ad_user_data: advertising, ad_personalization: 'denied' };
}
export function initializeMeasurement() {
  if (!measurementConfigured || initialized) return;
  initialized = true;
  window.dataLayer ??= [];
  // Google's documented bootstrap queues Arguments objects.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function () { window.dataLayer!.push(arguments); };
  window.gtag('consent', 'default', denied);
  window.gtag('set', 'ads_data_redaction', true);
  window.gtag('set', 'url_passthrough', false);
}
export function setMeasurementChoice(choice: MeasurementChoice, advertising = false) {
  initializeMeasurement();
  try { localStorage.setItem(STORAGE, JSON.stringify({ choice, advertising: choice === 'granted' && advertising === true, expires: Date.now() + 180 * 86400000 })); } catch { /* Optional storage. */ }
  window.gtag?.('consent', 'update', currentConsent());
  window.dispatchEvent(new Event(CHANGE));
}
export function onMeasurementChange(listener: () => void) {
  window.addEventListener(CHANGE, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(CHANGE, listener); window.removeEventListener('storage', listener); };
}
function safeLocation() {
  // Never send agreement/payment tokens, reservation references or account paths.
  const url = new URL(window.location.href);
  const path = url.pathname.startsWith('/booking/') ? '/booking' : url.pathname.startsWith('/vehicle/') ? url.pathname : ['/', '/fleet', '/partners', '/contact'].includes(url.pathname) ? url.pathname : '/account';
  const safe = new URL(path, url.origin);
  for (const key of ['gclid', 'gbraid', 'wbraid']) { const value = url.searchParams.get(key); if (value && /^[A-Za-z0-9_.~-]{1,500}$/.test(value)) safe.searchParams.set(key, value); }
  return safe.href;
}
async function loadTag() {
  initializeMeasurement();
  // Also propagate withdrawal/expiry from another tab to an already loaded tag.
  window.gtag?.('consent', 'update', currentConsent());
  if (!measurementConfigured || readMeasurementChoice() !== 'granted') return false;
  if (!tag) {
    tag = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4 || ads)}`;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); tag = undefined; reject(new Error('Measurement unavailable.')); };
      window.gtag?.('js', new Date());
      const options = { send_page_view: false, page_location: safeLocation(), page_referrer: '', page_title: 'ZONYX', allow_google_signals: false, allow_ad_personalization_signals: false };
      if (ga4) window.gtag?.('config', ga4, options);
      if (ads && label) window.gtag?.('config', ads, options);
      document.head.appendChild(script);
    });
  }
  try { await tag; return readMeasurementChoice() === 'granted'; } catch { return false; }
}
const viewed = new Set<string>();
export async function startMeasurement() {
  if (!await loadTag() || !ga4) return;
  const location = safeLocation();
  if (viewed.has(location)) return;
  viewed.add(location);
  window.gtag?.('event', 'page_view', { send_to: ga4, page_location: location, page_referrer: '', page_title: 'ZONYX' });
}
export async function trackVerifiedPurchase(bookingId: string, purchase: VerifiedPurchase) {
  if (!isPurchaseEligible(bookingId, purchase) || !await loadTag() || !isPurchaseEligible(bookingId, purchase)) return;
  const emit = () => {
    if (readMeasurementChoice() !== 'granted') return;
    for (const destination of [ga4, ads && label && readAdvertisingChoice() ? `${ads}/${label}` : ''].filter(Boolean)) {
      const key = purchaseKey(destination, purchase);
      // Fail closed if persistent deduplication is unavailable. Google also
      // deduplicates this stable transaction_id across browsers/devices.
      try {
        if (emitted.has(key) || localStorage.getItem(key)) continue;
        localStorage.setItem(key, 'queued');
      } catch { continue; }
      emitted.add(key);
      const common = { send_to: destination, transaction_id: purchase.transaction_id, value: purchase.value, currency: purchase.currency, page_location: `${window.location.origin}/booking/confirmed`, page_referrer: '', page_title: 'ZONYX Booking Confirmed' };
      window.gtag?.('event', destination === ga4 ? 'purchase' : 'conversion', destination === ga4 ? { ...common, items: [{ item_id: 'ev_rental', item_name: 'ZONYX EV rental', price: purchase.value, quantity: 1 }] } : common);
    }
  };
  if (navigator.locks) await navigator.locks.request(`zonyx-purchase-${purchase.transaction_id}`, emit);
  else emit();
}
