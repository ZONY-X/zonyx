# ZONYX Pay: runtime processor control

## Admin operation

Open Admin → ZONYX Pay. The panel reads Active processor and server-derived readiness, displays all known processors, and offers No active processor. Choose a ready processor, optionally enter a reason (500 characters maximum), click Set active processor, then Confirm activation. Cancel makes no request. A stale version or failed change leaves the selection unchanged; refresh and review again. No active processor intentionally blocks new transactions.

Square and PayPal are the only implemented processors eligible for activation, subject to server configuration. Authorize.Net is a scaffold; Chase, Clover and Finix are not implemented: all show Not configured and cannot activate. Stripe appears Historical only for existing payments. None is always selectable. Ready means the existing integration's environment, credentials and activation gates are configured, not that a live network health check or business eligibility check was performed. Booking-specific eligibility and existing release/tester gates continue to apply.

## Source of truth and migration

`payment_runtime_config` is the sole operational source for new payment selection. Its singleton boolean id=true row contains active_provider, version, updated_at. The migration seeds `none`, intentionally blocking new payments until an administrator selects a ready processor. Missing row, database read failure, none or unready processor fails closed. Selection is read for every new routing decision, without a module cache. No fallback or default to Square.

`ACTIVE_PAYMENT_PROVIDER` secrets are ignored by the operational paths. No compatibility fallback was retained. The synchronous adapter resolver accepts only an explicit selection value supplied from the runtime row. No runtime code reads the old secret. Remove the obsolete secret during a later authorized rollout if desired; the Admin does not manage secrets. Provider credentials/release gates remain server secrets and cannot be changed from this panel.

Local migration file: `supabase/migrations/20261101011625_payment_runtime_admin.sql`. In a future authorized rollout, apply this migration before deploying the runtime-aware functions and Admin together. Deploy `admin-payment-runtime`, `payment-routing`, and every function importing the routing helpers (including square-checkout, paypal-checkout, renewal-checkout, rental-extension-actions) together. New transactions remain blocked at none until Admin activation. This work does not apply remote migrations or deploy anything.

## Access and audit

Browser calls only `admin-payment-runtime` (POST action=read or activate). The function validates the user with getUser and checks the existing authoritative `current_profile_is_admin` RPC using that user's authorization. No client admin flag is trusted. The server computes provider readiness, validates the requested processor, and calls a service-role-only SQL function with expectedVersion. No management tokens or service keys reach the browser.

Config and audit tables have RLS enabled, no browser policies, and all PUBLIC/anon/authenticated privileges revoked. Only service_role can read/update config or append/read audit. `set_payment_runtime_provider` uses SECURITY INVOKER, is executable only by service_role, rechecks the existing authoritative admin identity invariant, locks the singleton, rejects stale versions, and atomically updates config plus inserts audit. Audit includes actor auth user UUID, old/new processor, changed_at, reason. If audit insertion fails, config rolls back. Readiness belongs in the server Edge Function because credentials and gates are not stored in SQL.

## Existing transactions

Existing booking_payments.provider and renewal links/attempts remain authoritative, even under none, a broken config or an unavailable active processor. Existing provider checks, settlement, receipts, webhooks, deposits, reservations and agreements are unchanged. New PayPal renewal links remain unsupported and fail explicitly; there is no switch to Square. An existing unsupported historical payment requires support rather than a new payment on another rail.

## Offline verification

- `npm run test:unit`: routing, runtime switches, admin handler, affinity, readiness and no fallback.
- `npm run test:payments`: existing payment contracts and offline simulations; never live payments.
- `npm run test:schema`: PGlite migrations + pgTAP, including payment_runtime.test.sql (role denials, atomic audit, stale changes, rollback).
- `npx playwright test --config playwright.payment-runtime.config.ts`: fixture-only Admin selector, disabled options, cancellation, confirmation, none, rejection and read failure.
- `npx playwright test --config playwright.payment-routing.config.ts`: existing public routing fixtures.
- `npm run build`; `npx tsc --noEmit -p tsconfig.app.json`.
