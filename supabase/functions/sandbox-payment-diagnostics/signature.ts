import { Buffer } from "node:buffer";
import { verify } from "node:crypto";
// PayPal signs transmissionId|timestamp|webhookId|CRC32(original raw body).
export function paypalSignedMessage(raw: string, headers: Headers, webhookId: string) {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(raw)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return `${headers.get("paypal-transmission-id")}|${headers.get("paypal-transmission-time")}|${webhookId}|${(crc ^ 0xffffffff) >>> 0}`;
}
export function verifyPayPalDiagnosticSignature(raw: string, headers: Headers, webhookId: string, publicKey: string, now = Date.now()) {
  const time = Date.parse(headers.get("paypal-transmission-time") || "");
  if (headers.get("paypal-auth-algo") !== "SHA256withRSA" || !Number.isFinite(time) || Math.abs(now - time) > 300000 || !headers.get("paypal-transmission-id")) return false;
  try {
    return verify("RSA-SHA256", Buffer.from(paypalSignedMessage(raw, headers, webhookId)), publicKey, Buffer.from(headers.get("paypal-transmission-sig") || "", "base64"));
  } catch { return false; }
}
