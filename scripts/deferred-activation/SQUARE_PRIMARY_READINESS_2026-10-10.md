# Square primary preparation — 2026-10-10

Strategy: Square primary for new card checkout, PayPal alternative, no new Stripe checkout. ZONYX rents Tesla EVs at gozonyx.com. This is development preparation, not permission to transact.

## Verified repository state

PR #1 is merged. Its head was `0896ed41f27e2268ccc8b5d6de0b254acc402a78`; merge commit is `bd446854c7d27464c01e726430df365a32fa25c1`, merged 2026-10-10 20:18:07 UTC. This work started from current main `0f7768accd6e4161c8bd48d5092b9adf9efb33e8`, after PR #5. A GitHub Vercel success status exists for that main SHA; it does not establish deployed payment gates or business eligibility. Production runtime configuration was not inspected.

## Implemented preparation

- Explicit Square primary / PayPal alternative selection before any financial attempt. Existing persisted provider always wins. Lookup errors fail closed; no fallback after POST, timeout or uncertain result.
- Existing PayPal checkout, deposit, return, cancellation and webhook paths remain. Existing Stripe historical refund/hold/webhook paths remain. New Stripe customer checkout is retired at the server, frontend adapter and host link controls.
- Square Web Payments card tokenization; separate deposit authorization first (`autocomplete=false`, `delay_action=CANCEL`) and customer-approved rental charge second. No raw card storage, no CompletePayment/deposit capture API, no card-on-file or automatic renewal.
- Sandbox-only REST client using API version 2026-09-16, sandbox-only credential names, constant sandbox hostname and exact existing sandbox project allowlist `pvowzjqimikcoyjwclez`. No production path exists even if flags are set true.
- All checkout, operations, webhook, business verification, provider-lock and frontend gates default OFF. `square.env.example` explicitly lists false values. No environment or remote database was changed.
- Reservation provider lock, unique payment per booking, accepted immutable amount/itinerary checks and shared vehicle inventory claims. Durable one-winner claims precede every create/charge/void/refund POST. Tokens and provider errors are not persisted or logged.
- Canonical GET verifies provider reference, location, card source, exact USD amount, hold cancellation behavior and expiry. Lost CreatePayment responses can recover through signed webhooks using durable UUID references. No blind create retry after idempotency retention expires.
- HMAC SHA-256 webhook verification over the exact configured notification URL + raw body, constant-work comparison, merchant validation, canonical GET, event deduplication only after evidence persistence.
- Owner-controlled pre-trip cancellation: void deposit first, then verified rental refund (full amount including fee before confirmation). Claimed unknown outcomes require GET/webhook recovery. Refund completion and void cannot be undone by late observations. Booking cancellation only follows canonical terminal hold and complete refund. Shared inventory claims remain, consistent with the existing PayPal policy; no automatic claim release.
- Owner RLS receipts expose Square alongside unchanged PayPal receipts. Privileged RPCs are service-role-only. Square booking terms and Stripe identifiers cannot be changed after reservation.
- Branch-specific `vercel.json` rule disables automatic deployments from `square-primary-gated`; no main/project hosting setting changes.

## Validation

Local, synthetic, intercepted or network-free tests only; not real Square transactions:

- 26 unit-test files passed, including Square client, signature, hold safety, provider priority and fallback lock checks.
- Existing `test:payments` passed.
- 9 Square handler simulations passed: gates OFF, forged signature, existing PayPal lock, unknown outcomes, durable claims and caller-amount rejection.
- 52 migrations / 27 SQL suites / 253 pgTAP assertions passed in a fresh local PGlite PostgreSQL instance. No database URL or remote database access.
- Four Square browser scenarios passed: separated hold/rental, unknown hold blocks resubmission/fallback, existing PayPal lock, safe rental resumption after refresh.
- 36 PayPal browser scenarios passed (27 internal, 3 customer, 6 Standard).
- Frontend Vite compilation and lint of changed frontend files passed. Full `tsc` reports existing main errors; the initial comparison against a detached main checkout produced identical diagnostics. This is not a clean repository-wide typecheck.
- No Deno executable is available locally; mocked handlers are not deployed Edge Runtime validation. Genuine SDK, Edge, SCA, webhooks and provider tests remain required.

## Release blockers

1. Monday 2026-10-12: obtain explicit Square eligibility confirmation for Tesla vehicle rentals, refundable authorization holds, cancellation/void, and possible damage charges. General payment API availability is not business approval.
2. Square online card holds are limited to seven days. Preparation requires inspection deadline (return +24 hours) within 167 hours from checkout, and canonical hold expiry covering that deadline. Advance bookings and long rentals outside that window fail before rental charge. No substitute charged-and-refunded deposit and no unverified reauthorization mechanism.
3. Square account sandbox application/location/merchant and signed webhook metadata, genuine sandbox tests and scoped sandbox deployment approval are outstanding. Do not use live credentials.
4. Operational booking confirmation, trip release, damage capture, automatic renewal, notification delivery and inventory-claim release remain deliberately disabled/unimplemented for Square pending the verified business/deposit lifecycle. This PR is not ready for production activation.
5. Production payment gates and Square commercial eligibility have not been verified. A code priority or merged PR cannot establish those facts.

No merge, deployment, real charge or infrastructure purchase was performed. Do not apply migrations or turn on flags in ZONYX-PROD. Live implementation and activation require a later reviewed change.

## Primary references

- https://developer.squareup.com/docs/payments-api/take-payments/card-payments/delayed-capture
- https://developer.squareup.com/reference/square/payments-api/create-payment
- https://developer.squareup.com/reference/square/objects/Payment
- https://developer.squareup.com/docs/webhooks/step3validate
- https://developer.squareup.com/docs/web-payments/take-card-payment
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://vercel.com/docs/project-configuration/git-configuration
