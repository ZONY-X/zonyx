# Guest checkout and automatic ZONYX accounts

Prepared November 18, 2026 (America/New_York). No deployment or customer charge performed.

## Behavior

A customer selects the vehicle and dates, enters contact and driver details, reviews the current booking-specific agreement, and pays in the existing checkout. An anonymous Supabase session protects ownership during checkout. Its Auth email stays empty: the entered contact email is not an authentication claim, and knowing another customer's email never grants account access.

After canonical payment/deposit confirmation, an independent scheduled worker calls Supabase email OTP with `shouldCreateUser: true`. Supabase creates the permanent email account when needed, or emails the existing account without duplicating it. The worker returns no customer session and generates no password. The customer may open the expiring, single-use email link later and optionally set a password in an email-verified session.

Verified ownership creates a durable `guest_checkout_private.account_access` binding to the permanent customer. The original renter/signature/payment records keep their historical technical identity for audit integrity; that anonymous signer is not the permanent customer account. Guest reservations appear at `/booking/access`. Existing directly owned bookings remain in the normal dashboard.

Account creation, access-email delivery, and reservation-confirmation email are separate from financial mutations. The account and confirmation queues use independent leases/backoff, so one email outage does not repeat the other email or a payment. New intake can be disabled without stopping account recovery or handover checks for existing purchases.

## Root causes and fixes

- `Booking.tsx` redirected to `/auth` both before agreement review and before checkout. It had no guest contact/driver intake. It now obtains/reuses a protected anonymous session and saves guest details before calling the existing eligibility and agreement flow.
- Ownership was built around `profiles.user_id` / agreement signer IDs. Public `anon` access cannot safely replace those checks. The change retains existing RLS, verified JWTs and server-derived ownership rather than opening reservation or payment tables.
- Square rail selection allowed its checkout flag only for testers unless installation mode was enabled. Explicit guest intake now makes the already-enabled Square rail eligible; server environment, managed inventory, financial integrity and deposit checks still apply.
- No automatic guest-account service existed on the current main branch. A service-only, confirmed-purchase queue now creates permanent accounts through existing Supabase Auth, and links reservations only after verified email ownership.
- `booking-conversion` only recognized Square. It now verifies the matching Square or PayPal canonical payment; failed/pending/mismatched/refunded payments still cannot produce confirmation. Sandbox confirmations do not produce purchase revenue events.
- Square had no independent guest confirmation-email retry path. The worker now retries the existing confirmation function separately; the function requires canonical confirmation for both current processors.
- The Vite development entry evaluated `lazy()` declarations before its React import was initialized. The import now precedes those declarations.

Pricing, vehicle availability checks, existing contract text/version, payment SDKs, capture/idempotency/deposit rules and customer records are retained. No new payment processor was introduced. Driver self-attestation remains before payment; audited host/admin identity and original-license checks are required before a guest trip can become active.

## Validation and its limits

Run `npm ci`, `npm run test:guest-checkout`, `npm run test:schema`, `npm run test:unit`, `node scripts/test-booking-conversion.mjs`, and `npm run build`.

The guest suite includes a brand-new generated email and empty browser storage on desktop (1440px) and mobile (390px). It covers vehicle selection, dates, driver details, agreement acceptance, simulated card/deposit checkout, confirmation, email-link return, reservation visibility and optional password setup. It asserts no email/password registration or prepayment verification request and no duplicate rental submission.

A separate isolated PostgreSQL test runs the actual migrations, payment/deposit SQL transitions and account handler. It covers brand-new permanent-account creation through an Auth simulator, email outage/retry, rejection of unverified access, durable verified association, existing-email redelivery without duplicate accounts, independent confirmation-email retry and unchanged booking/payment/agreement records. Auth delivery/activation and processor responses are simulated. Browser REST/processor boundaries are intercepted; these are not hosted Supabase/Auth, real mailbox, PayPal or Square transaction certificates.

The full project TypeScript check still reports existing schema-typing errors in unrelated legacy components and the existing `profiles.is_internal_tester` generated typing. The production build succeeds. This change does not claim that the pre-existing repository is globally type-clean.

## Publication steps — approval required before any deployment

1. Review this patch against current `ZONY-X/zonyx` main and the functions currently deployed. Production and Sandbox have additional historical work; do not reset either database, copy old processor functions over newer ones, or blindly replay the complete migration directory.
2. After deployment approval, apply only `20261119022948_guest_reservation_checkout.sql` to an isolated approved test environment that does not already contain the Sandbox account schema. The existing Sandbox already has a version of `guest_checkout_private`; reconcile it with a reviewed additive upgrade rather than re-running this create-schema migration there. Run SQL tests/advisors and confirm private tables/functions remain inaccessible to browser roles.
3. Publish only the reviewed `guest-account`, `rental-agreement`, `booking-conversion`, and `send-booking-confirmation` changes, including their new shared dependencies. `guest-account` uses `verify_jwt=false` at the gateway and independently validates customer/staff JWTs with `auth.getUser`; its worker route checks a separate server-only secret.
4. Enable anonymous sign-ins in that environment's Supabase Auth. Configure its existing SMTP and email templates with a working single-use Auth link. Allow the exact HTTPS `/booking/access` redirect. Do not auto-confirm customer emails or create plaintext passwords.
5. Set backend `GUEST_CHECKOUT_ENABLED=true`, `GUEST_ACCOUNT_INVITATIONS_ENABLED=true`, `GUEST_CONFIRMATION_EMAILS_ENABLED=true`, `APP_PUBLIC_URL` to the exact HTTPS origin, and a unique server-only `GUEST_ACCOUNT_WORKER_SECRET` of at least 32 characters. Keep provider/environment/inventory/deposit gates unchanged. In tests only, `GUEST_ACCOUNT_SANDBOX_EMAIL_ENABLED=true` permits Sandbox mail jobs. Leave it unset/false for production.
6. Store the worker URL, worker secret and project publishable key in Vault, then install the one-minute scheduler from `supabase/ops/guest-account-scheduler.sql`. Preserve existing Resend confirmation configuration. Monitor both private queues, cron and HTTP outcomes; exhausted jobs require an email/account retry, never a payment replay.
7. Build the frontend with `VITE_GUEST_CHECKOUT_ENABLED=true` and the already-approved processor configuration. Square requires its existing `VITE_SQUARE_CHECKOUT_ENABLED=true`; PayPal requires its existing customer/Standard/card readiness flags. This patch does not enable a processor or expand its approved inventory by itself.
8. Before production approval, complete a real processor-Sandbox transaction and real test-mail delivery with a new email and a fresh browser. Verify: confirmed booking and accepted agreement; exactly one canonical rental payment; required uncaptured deposit; permanent Auth account; no access before email verification; durable account binding afterward; optional password setup; repeat refresh/webhook/email delivery without duplicate charge/account. Repeat with an existing account email and a failed/uncertain payment.
9. Only after those checks and explicit approval, repeat the reviewed release in production. No live deployment or charge has been authorized by this task.

Rollback new intake by disabling the frontend guest flag and backend `GUEST_CHECKOUT_ENABLED`. Keep account delivery, confirmation retries, access and handover services available for existing purchases. Preserve private records and immutable signatures; do not drop their schema or delete historical anonymous signers.

Supabase references: [anonymous sessions](https://supabase.com/docs/guides/auth/auth-anonymous), [email passwordless access](https://supabase.com/docs/guides/auth/auth-email-passwordless), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
