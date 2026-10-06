# PayPal internal checkout implementation

This branch is reviewable code for internal testing. It is not a production rollout. No migration, function deployment, live financial API call, production webhook configuration, or secret change was performed.

## Baseline and preservation

Original repository: `/Users/zoeyentertainment/Downloads/wheel-joy-app-main`.
Original local HEAD/main: `a435643707c3a3bea1c3b93bf2026b054ed14215`.
Implementation baseline: fetched `origin/main`, `39262fc61b5b2e25c1e455c4ab8a5e73ba58faba`.
The original checkout, index, branch, tracked environment file, ignored files, and all uncommitted work were left untouched. A private sibling `local-work-preserved` directory preserves 79 modified/untracked source files. Environment files, npm credential configuration, and Supabase temporary connection metadata were excluded; those originals remain untouched in the original checkout. Nothing from that backup was committed.

Local HEAD predates main's booking-specific immutable Rental Agreement, driver validation, started-24-hour pricing, financial ledger, executed amendments, and renewal schedules. Much local work already exists on main. Divergent local checkout files use the older boolean agreement acceptance and client add-on/promo payload; substituting them would regress the current financial authority. Unique local diagnostics, reconciliation helpers, legal pages, and earlier migration variants are preserved for separate review, not silently discarded or copied over current main. The useful local request-timeout behavior was independently added to the isolated Stripe client without replacing the current accepted-agreement payload.

Source snapshot comparison with main: {"already_on_main": 10, "differs_from_main": 53, "local_only": 16}.

## Provider boundary and storage

The return route is absent unless the frontend internal flag is enabled; even then its client profile gate redirects ordinary users before any PayPal request. The server independently enforces authorization.

`startRentalCheckout(provider, { bookingId, agreementId })` separates booking/agreement creation from payment transport. `PaymentProvider` and the database provider discriminator permit future names; a new provider needs an explicit adapter and RPC registry entry, rather than a booking-flow rewrite. Unknown adapters fail closed.

Additive migration: `supabase/migrations/20261003223707_provider_neutral_paypal_checkout.sql` (NOT applied).

- `booking_payments`: one rental-payment reservation per booking; provider/environment, immutable accepted amount, agreement identity, stable create/capture request UUIDs, order/capture identifiers, and durable operation state. No historical backfill.
- `booking_security_deposits`: separate AUTHORIZE lifecycle with generation number, independent provider identifiers, authorized/captured amounts, honor-period, expiry and renewal timestamps. This release records only `disabled` or `capability_verification_required`.
- `payment_webhook_receipts`: authenticated event deduplication; only event identity/type is stored, not raw payer payloads.
- Service-only SECURITY INVOKER mutation RPCs reserve/attach/claim/finalize. PUBLIC/anon/authenticated execution is revoked. Tables enforce RLS and deny client writes. Owner/admin receipt reads remain explicit.
- A booking trigger prevents PayPal payments from acquiring Stripe identifiers, changing accepted financial/schedule terms, becoming operational, or being cancelled during an unresolved capture.
- An additive receipt read adapter reports PayPal captured funds separately from the historical Stripe financial ledger. It does not infer a net balance after an external reversal/refund. Existing Stripe reconciliation and data are retained.

Stripe checkout reserves the same provider boundary before creating a new Stripe session. Stripe historical identifiers, webhook, hold, release/capture, refunds, reconciliation, and renewal functions remain intact. Existing Stripe reservations still use their existing lifecycle; the new Stripe reservation record is a provider lock, not a replacement Stripe settlement ledger. Apply the additive migration before deploying the modified Stripe checkout function.

## Rental-payment lifecycle

1. Existing vehicle/date/availability/promo/add-on/eligibility flow prepares a server-priced booking-specific agreement. Acceptance creates the booking with persisted financial terms.
2. `paypal-checkout` validates the authenticated user with `auth.getUser`, the configured internal tester's auth email, the server internal-test flag, profile access, accepted agreement ownership/hash, terms acceptance, server-side amounts, currency and explicitly allowlisted ZONYX-managed vehicle IDs. It never accepts an amount, payment source, stored-method token, or provider order ID from the client.
3. A transaction locks the booking and reserves exactly one provider/payment. Agreement amounts and reservation fields must match the booking. Only the first caller may dispatch order creation.
4. Server OAuth uses credentials only in memory. Sandbox uses separate sandbox credentials; existing LIVE credentials are used only when the environment is live AND the separate live-rental gate has been approved and enabled. Credentials/tokens/provider bodies are never logged or returned.
5. Orders v2 creates a CAPTURE order with stable `PayPal-Request-Id`, amount from the accepted snapshot, and a provider payment UUID as reference/custom/invoice identity. Approval/return origins are validated and cannot come from a client's Origin header.
6. On return, query-string tokens are ignored as payment evidence. Backend retrieves the persisted order, validates identity/currency/amount/intent, requires APPROVED status, revalidates the booking and availability, and uses a database compare-and-set capture claim. Only one caller may POST capture.
7. After capture, GET retrieves the canonical complete order for verification. Only a COMPLETED order with exactly one COMPLETED capture of the expected amount is persisted as paid. The separate disabled deposit record is created automatically in the same finalization transaction.
8. No PayPal booking becomes confirmed/active in this release. Paid rental money is recorded, but the separate required deposit is unavailable. The browser and receipt show that the trip is not confirmed. No Stripe hold or confirmation email is invoked for PayPal.
9. Cancellation before capture records cancellation without a PayPal financial call. Declines/failures do not confirm bookings. Capture ambiguity is reconciled via GET of the same order, never another capture POST. Cancelled/failed orders are not automatically replaced.

## Exact default gates

No environment/secret values were created, modified, retrieved, or printed by this task.

| Setting | Default/effective state in this release | Requirement for a later approved test |
|---|---|---|
| `VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED` | unset = OFF | Frontend internal-only adapter; ordinary users remain on existing checkout |
| `PAYPAL_RENTAL_CHECKOUT_ENABLED` | unset = OFF | Backend create/capture/webhook gate |
| `PAYPAL_ENVIRONMENT` | unset = sandbox | Explicit sandbox/live selection |
| `PAYPAL_LIVE_RENTAL_PAYMENT_ENABLED` | unset = OFF | Separate gate; no live transaction is authorized by this task |
| `PAYPAL_SECURITY_DEPOSIT_ENABLED` | unset = OFF | Even `true` only records `capability_verification_required`; no authorization implementation/network request exists |
| `ZONYX_INTERNAL_TEST_ENABLED`, `ZONYX_INTERNAL_TEST_EMAIL`, `ZONYX_INTERNAL_TEST_CODE` | Existing values unchanged | Existing preparation test pricing/consent gate; auth email validated again at checkout |
| `PAYPAL_MANAGED_VEHICLE_IDS` | unset = deny all | Comma-separated reviewed ZONYX-managed vehicle UUIDs; no host marketplace |
| `PAYPAL_CHECKOUT_RETURN_ORIGIN` | unset = unavailable | Reviewed exact origin, no trailing slash/path; HTTPS except sandbox localhost |
| `PAYPAL_WEBHOOK_ID` | unset = disabled | ID from the matching environment/application listener |

Existing `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` stay securely in Supabase; do not copy them into the browser, repository, tests, or local configuration. Future sandbox testing needs **separate** `PAYPAL_SANDBOX_CLIENT_ID` / `PAYPAL_SANDBOX_CLIENT_SECRET`; never point the sandbox at live credentials.

`enabled=true` in function config declares code availability if explicitly deployed. It does not deploy the function or enable the environment gates. `verify_jwt=false` follows this repository's explicit `auth.getUser` convention for checkout and permits signed PayPal webhook requests without a Supabase user JWT.

## Security deposit and long rentals

Automatic paid-rental finalization schedules a separate deposit lifecycle record. There is no administrator charge workflow, no authorization/capture/void endpoint for PayPal deposits, and no vault/off-session assumption. The planner always returns `canAuthorize=false`, including if the feature flag is accidentally enabled. A capability-approved adapter must be built before enabling this lifecycle.

Before an implementation capable of real deposit authorization is approved, verify the account's eligibility for separate AUTHORIZE orders, customer consent/payment-source reuse requirements, whether an additional payer approval is needed, permitted capture/void/partial-capture behavior, merchant-initiated/vault eligibility, authorization expiration, honor periods, reauthorization limits, and fees. PayPal documents a finite authorization lifecycle, not an indefinite hold. The generation/expiry/renewal fields are intentionally separate from rental payments so long rentals can renew consent/authorization without recapturing rent.

No stored payment methods, card/vault capability, multiparty processing, third-party seller onboarding, payouts, split settlement, or marketplace behavior was implemented.

## Webhooks (manual setup only after approval)

New handler: `paypal-webhook`. Proposed listener URL, only after approved deployment:
`https://fazzuetfwwfiqehpnjky.supabase.co/functions/v1/paypal-webhook`.

Required event subscriptions for the matching PayPal app/environment:

- `CHECKOUT.ORDER.APPROVED`
- `CHECKOUT.ORDER.COMPLETED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.PENDING`
- `PAYMENT.CAPTURE.DENIED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`

The supported postback verification API receives transmission headers, configured webhook ID, and original parsed event. Processing requires `verification_status=SUCCESS`. Certificates are restricted to exact PayPal API origins for the selected environment. The handler never trusts an event as amount evidence: it GETs the linked known order and verifies persisted identities/amounts. Approval events do **not** trigger automatic capture. Unknown orders/persistence errors return non-2xx for redelivery. Replayed events deduplicate; capture finalization itself is atomic and idempotent. Refund/reversal events preserve the paid receipt and flag reconciliation instead of initiating a financial action or claiming settled balances. Simulator mock events are not supported by PayPal postback verification; our tests mock the verifier.

No webhook was created/configured/deployed. Deposit-specific authorization events should be specified with the future approved deposit adapter; they are not silently enabled here.

## Recovery and rollout limits

Do not clear the provider lock, generate a new request UUID, recreate an order, switch providers, or delete a payment record to resolve an ambiguous outcome. An unknown create outcome remains `creating` and requires an approved operator to reconcile the original UUID/invoice in PayPal before any reset is considered. A lost capture response remains `capturing`; the same return-page status check or verified webhook GETs the original order and finalizes only proven funds. If capture was claimed but no POST was dispatched (e.g. process crash), the flow deliberately stays unresolved rather than risk a second capture. There is no blind retry after PayPal idempotency retention expires.

Rental-payment testing is implemented; this is not a complete production booking/payment rollout. Live test payments, production migrations/deployment, production webhook registration, activation of any live/payment flag, production refunds/actions, customer rollout, operational confirmation, and deposit activation all require explicit approval. Production rollout also requires account capability verification, sandbox credential configuration and approved end-to-end sandbox exercise, baseline lint/type remediation, and reviewed customer cancellation/refund/reconciliation handling for PayPal. No PayPal refund action is implemented. Keep internal PayPal trips out of operational workflows.

A full local Supabase schema/pgTAP regression run is still required before deployment: this machine lacks Docker/local Supabase PostgreSQL. Focused migration tests execute real SQL against an in-memory PGlite PostgreSQL engine with representative schema fixtures, not production data. They do not prove the entire existing schema/RPC graph.

## Reproducible checks

Use Node 24.18+ (native TypeScript transformation/hooks) and the pinned lockfile.

- `npm run test:unit`: all local unit files, aliases resolved and global fetch blocked.
- `npm run test:payments`: focused mocked policy/client tests plus actual SQL migration tests in PGlite.
- `npm run test:paypal-ui`: existing desktop/mobile agreement acceptance plus mocked PayPal return checks. Browser external DNS is blocked; all Supabase responses are intercepted. The test-only frontend flag does not modify production settings.
- `npm run build`; `npm run lint`; `npx tsc -p tsconfig.app.json`.
- Deno check the new checkout/webhook and modified Stripe checkout; this compiles handlers without running them.

## Primary references

- [PayPal Orders v2](https://developer.paypal.com/api/orders/v2)
- [Capture order and representation responses](https://developer.paypal.com/api/orders/v2/orders-capture)
- [PayPal idempotency](https://developer.paypal.com/api/rest/reference/idempotency/)
- [PayPal webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/)
- [PayPal authorization lifecycle](https://developer.paypal.com/checkout/delay-capture/)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)

## Verified results for this branch

- Production build: PASS.
- Existing/new local unit suite: 23 test files PASS (network blocked).
- Focused policy/client suite: 11 tests PASS (synthetic mocked transport only).
- PGlite migration suite: 19 checks PASS; actual in-memory PostgreSQL, fixture schema.
- Browser suite: 8 tests PASS, including existing desktop/mobile agreement review and ordinary-user exclusion.
- Deno checks: new checkout/webhook, modified Stripe checkout and focused test files PASS.
- Full frontend type check: 87 existing errors, identical baseline diagnostics; zero new errors.
- Full lint: 30 errors / 18 warnings, identical baseline counts; focused new code and receipt component PASS.
- Full Supabase schema/pgTAP suite: not run; Docker/local Supabase PostgreSQL unavailable.
- Original checkout's 79 preserved source files compare byte-for-byte unchanged; original main HEAD remains a435643.

## Every implementation file

- `.gitignore`
- `PAYPAL_IMPLEMENTATION.md`
- `deno.lock`
- `e2e/paypal-return.spec.ts`
- `package-lock.json`
- `package.json`
- `playwright.paypal.config.ts`
- `scripts/register-test-loader.mjs`
- `scripts/run-unit-tests.mjs`
- `scripts/test-payment-migration.mjs`
- `src/App.tsx`
- `src/components/booking/BookingFinancialSummary.tsx`
- `src/lib/payments.ts`
- `src/lib/stripe.ts`
- `src/pages/Booking.tsx`
- `src/pages/PayPalReturn.tsx`
- `supabase/config.toml`
- `supabase/functions/_shared/payment-policy.test.ts`
- `supabase/functions/_shared/payment-policy.ts`
- `supabase/functions/_shared/payment-service.ts`
- `supabase/functions/_shared/paypal-client.test.ts`
- `supabase/functions/_shared/paypal-client.ts`
- `supabase/functions/paypal-checkout/index.ts`
- `supabase/functions/paypal-webhook/index.ts`
- `supabase/functions/stripe-checkout/index.ts`
- `supabase/migrations/20261003223707_provider_neutral_paypal_checkout.sql`
