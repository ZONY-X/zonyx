import { createHmac, timingSafeEqual } from "node:crypto";
export function verifySandboxStripeSignature(body: string, header: string, secret: string, now = Date.now()) {
  const parts = header.split(",");
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = new TextEncoder().encode(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"));
  return parts.filter(p => p.startsWith("v1=")).some(p => {
    const supplied = new TextEncoder().encode(p.slice(3));
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
