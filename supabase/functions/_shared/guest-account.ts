import { parseGuestContact } from "../../../src/lib/guestCheckoutPolicy.ts";

type Result<T = unknown> = { data: T; error: unknown };
type AuthUser = { id: string; is_anonymous?: boolean; email?: string; email_confirmed_at?: string };
type InvitationJob = { booking_id: string; email: string; lease_id: string };
type Client = {
  functions?: { invoke: (name: string, input: {body: {bookingId: string}}) => Promise<Result<{sent?: boolean; skipped?: boolean}>> };
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<Result>;
  auth: {
    getUser: () => Promise<Result<{ user: AuthUser | null }>>;
    signInWithOtp: (input: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }) => Promise<Result<{ session: unknown }>>;
  };
};
type Dependencies = { env: (name: string) => string | undefined; client: (authorization?: string) => Client };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretMatches(actual: string, expected: string) {
  if (expected.length < 32 || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Independent account service: no provider imports, no financial mutations.
export async function handleGuestAccount(request: Request, deps: Dependencies) {
  const origin = request.headers.get("Origin");
  const sandboxLocalOrigin = deps.env("SUPABASE_URL") === "https://pvowzjqimikcoyjwclez.supabase.co"
    && origin === "http://127.0.0.1:4175";
  const headers = {
    "Access-Control-Allow-Origin": sandboxLocalOrigin ? origin : deps.env("APP_PUBLIC_URL") || "http://localhost",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });
  try {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return reply(401, { error: "Valid session required." });
    let input: unknown;
    try { input = await request.json(); }
    catch { return reply(400, { error: "Invalid request." }); }
    if (!isRecord(input)) return reply(400, { error: "Invalid request." });
    // Intake rollback must preserve paid reservations, invitations and handover.
    if (input.action === "contact" && deps.env("GUEST_CHECKOUT_ENABLED") !== "true") return reply(403, { error: "Guest checkout is unavailable." });
    if (input.action === "deliver-invitations") {
      if (!secretMatches(authorization.slice(7), deps.env("GUEST_ACCOUNT_WORKER_SECRET") || "")) return reply(403, { error: "Forbidden." });
      if (deps.env("GUEST_ACCOUNT_INVITATIONS_ENABLED") !== "true") return reply(403, { error: "Account invitations are disabled." });
      const publicUrl = new URL(deps.env("APP_PUBLIC_URL") || "");
      if (publicUrl.protocol !== "https:" || publicUrl.origin !== deps.env("APP_PUBLIC_URL")) return reply(503, { error: "Invitation configuration unavailable." });
      const db = deps.client();
      const claimed = await db.rpc("claim_guest_account_invitations", { _sandbox: deps.env("GUEST_ACCOUNT_SANDBOX_EMAIL_ENABLED") === "true" });
      if (claimed.error) return reply(503, { error: "Invitation queue unavailable." });
      let sent = 0, pending = 0;
      for (const job of (claimed.data || []) as InvitationJob[]) {
        let delivered = false;
        try {
          // Existing SMTP/templates and Auth's unique email identity. This sends
          // an expiring one-time access link, never a password or browser session.
          // New permanent accounts are created here, only after confirmation.
          const result = await db.auth.signInWithOtp({ email: job.email, options: {
            shouldCreateUser: true, emailRedirectTo: `${publicUrl.origin}/booking/access`,
          } });
          delivered = !result.error && !result.data?.session;
        } catch { /* Keep booking/payment state unchanged and retry the mail job. */ }
        const finished = await db.rpc("finish_guest_account_invitation", {
          _booking_id: job.booking_id, _lease_id: job.lease_id, _sent: delivered,
        });
        if (delivered && !finished.error) sent++; else pending++;
      }
      // Email/provider outages cannot change payment or block permanent-account creation.
      if (deps.env("GUEST_CONFIRMATION_EMAILS_ENABLED") === "true") {
        let confirmationsSent = 0, confirmationsPending = 0;
        try {
          const jobs = await db.rpc("claim_guest_confirmation_emails", { _sandbox: deps.env("GUEST_ACCOUNT_SANDBOX_EMAIL_ENABLED") === "true" });
          if (jobs.error) throw new Error("Confirmation queue unavailable");
          for (const job of (jobs.data || []) as Array<{booking_id: string; lease_id: string}>) {
            let delivered = false;
            try {
              const response = await db.functions?.invoke("send-booking-confirmation", {body: {bookingId: job.booking_id}});
              delivered = !!response && !response.error && (response.data?.sent === true || response.data?.skipped === true);
            } catch { /* Retry this email independently. */ }
            const finished = await db.rpc("finish_guest_confirmation_email", {_booking_id: job.booking_id, _lease_id: job.lease_id, _sent: delivered});
            if (delivered && !finished.error) confirmationsSent++; else confirmationsPending++;
          }
        } catch { confirmationsPending++; }
        return reply(200, {sent, pending, confirmationsSent, confirmationsPending});
      }
      return reply(200, { sent, pending });
    }
    const scoped = deps.client(authorization);
    const auth = await scoped.auth.getUser();
    const user = auth.data?.user;
    if (auth.error || !user) return reply(401, { error: "Valid session required." });
    const db = deps.client();
    if (input.action === "contact") {
      if (!user.is_anonymous) return reply(403, { error: "Guest identity required." });
      if (Object.keys(input).some(k => !["action", "fullName", "email", "phone"].includes(k))) return reply(400, { error: "Invalid contact details." });
      const contact = parseGuestContact(input);
      const saved = await db.rpc("save_guest_checkout_contact", { _user_id: user.id, _full_name: contact.fullName, _email: contact.email, _phone: contact.phone });
      return saved.error ? reply(409, { error: "Contact details could not be saved. Reviewed agreement contact details cannot be changed." }) : reply(200, { saved: true });
    }
    if (input.action === "status") {
      const bookingId = input.bookingId;
      if (Object.keys(input).some(k => !["action", "bookingId"].includes(k)) || typeof bookingId !== "string" || !uuid.test(bookingId)) return reply(400, { error: "Valid booking reference required." });
      const result = await db.rpc("get_guest_checkout_account_status", { _user_id: user.id, _booking_id: bookingId });
      return result.error ? reply(404, { error: "Booking not found." }) : reply(200, result.data);
    }
    if (input.action === "bookings") {
      if (Object.keys(input).some(k => k !== "action")) return reply(400, { error: "Invalid request." });
      if (user.is_anonymous || !user.email || !user.email_confirmed_at) return reply(403, { error: "Verify your email to access reservations." });
      const result = await db.rpc("get_verified_guest_account_bookings", { _user_id: user.id });
      return result.error ? reply(503, { error: "Reservations are temporarily unavailable." }) : reply(200, { bookings: result.data });
    }
    if (input.action === "handover-status" || input.action === "verify-handover") {
      if (user.is_anonymous || !user.email_confirmed_at) return reply(403, { error: "Verified staff session required." });
      const bookingId = input.bookingId;
      if (Object.keys(input).some(k => !["action", "bookingId", "identityChecked", "licenseChecked"].includes(k)) || typeof bookingId !== "string" || !uuid.test(bookingId)) return reply(400, { error: "Valid booking reference required." });
      const approve = input.action === "verify-handover";
      if (approve && (input.identityChecked !== true || input.licenseChecked !== true)) return reply(400, { error: "Check identity and driver license before handover." });
      const result = await db.rpc("guest_checkout_handover", { _actor_user_id: user.id, _booking_id: bookingId, _approve: approve });
      return result.error ? reply(403, { error: "Handover verification requires the host or an administrator and a confirmed guest booking." }) : reply(200, result.data);
    }
    return reply(400, { error: "Invalid request." });
  } catch { return reply(500, { error: "Unable to process account request." }); }
}
