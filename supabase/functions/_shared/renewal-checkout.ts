export const RENEWAL_MODULE = 'zonyx_guest_renewal_v1';
export const RENEWAL_ORIGIN = 'https://www.gozonyx.com';
export type RenewalPreview = { scope: 'renewal-preview'; exp: number; period_id: string; reservation_number: string; period_start: string; period_end: string; amount_cents: number; currency: string };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
async function previewKey(secret: string) { return crypto.subtle.importKey('raw', new TextEncoder().encode(`zonyx-renewal-preview:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function signRenewalPreview(data: RenewalPreview, secret: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify(data)));
  const signature = await crypto.subtle.sign('HMAC', await previewKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyRenewalPreview(token: string, secret: string): Promise<RenewalPreview> {
  const parts = token.split('.');
  if (parts.length !== 2 || token.length > 3000 || !await crypto.subtle.verify('HMAC', await previewKey(secret), decode(parts[1]), new TextEncoder().encode(parts[0]))) throw new Error('Invalid preview link.');
  const data = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as RenewalPreview;
  if (data.scope !== 'renewal-preview' || data.exp <= Date.now() || !Number.isSafeInteger(data.amount_cents) || data.currency !== 'usd') throw new Error('Preview link expired or invalid.');
  return data;
}
