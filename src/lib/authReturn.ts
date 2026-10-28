const KEY = 'zonyx-auth-return';
export function safeAuthReturn(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || (value.includes("\\") || Array.from(value).some(char => char.charCodeAt(0) <= 32))) return null;
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin || ['/auth', '/reset-password'].includes(url.pathname)) return null;
  return value;
}
export function rememberAuthReturn(value: string | null) {
  if (!safeAuthReturn(value)) return;
  try { localStorage.setItem(KEY, JSON.stringify({ path: value, expires: Date.now() + 86400000 })); } catch { /* Storage may be unavailable in private browsers. */ }
}
export function readAuthReturn(): string | null {
  try { const data = JSON.parse(localStorage.getItem(KEY) || 'null'); return data?.expires > Date.now() ? safeAuthReturn(data.path) : null; } catch { return null; }
}
export function clearAuthReturn() { try { localStorage.removeItem(KEY); } catch { /* Optional navigation convenience. */ } }
