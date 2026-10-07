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

## Expanded card checkout follow-up (2026-10-06)

The primary internal checkout now stays on ZONYX at `/booking/payment` after the existing booking-specific agreement is accepted and the server-priced booking is persisted. The existing visual components, rounded cards, typography and booking flow are preserved. The primary action is **Pay ZONYX**, with secure embedded number/expiry/CVV fields. PayPal is a secondary wallet button, which explicitly opens PayPal's existing approval flow. A link returns to the accepted agreement and its full financial summary. Ordinary production customers remain excluded by the original frontend/profile/backend/internal-agreement gates.

### Reused protections and additive changes

- Both presentation methods remain provider `paypal`; `checkout_method` independently distinguishes `card` from `paypal_wallet`. No Stripe columns, history, webhook/refund/hold functions or legacy ledgers are repurposed.
- Additional unapplied migration: `20261006201957_paypal_expanded_card_checkout.sql`. Apply it after the original additive provider migration and before any approved deployment of the updated checkout handler.
- `prepare_paypal_expanded_payment` wraps the original booking lock, accepted-agreement checks and single-dispatch reservation in one SQL transaction. A payment's chosen method cannot be switched by retries; unknown creation never releases the provider lock.
- The existing attach RPC accepts a NULL approval URL only for card orders. Wallet orders still require their approval URL. Card order creation returns the persisted order ID to the SDK; it never accepts client prices, card data or provider order IDs.
- New authenticated `checkout-config` action returns authoritative rental total, capability flag/environment and any existing payment reference/state. It does not call PayPal or create an order. Reloads of ambiguous/capturing/paid payments display a status-only recovery path rather than starting another payment.
- New authenticated `client-token` action additionally requires the default-off advanced-card gate before minting an SDK initialization token. It uses the existing matching-environment credentials with `response_type=client_token&intent=sdk_init`. This intentionally browser-safe token is distinct from the privileged REST OAuth token, which never leaves the server. Tokens are not persisted/logged, and the response is `Cache-Control: no-store`.
- PayPal JavaScript SDK v6 is loaded from a fixed environment-specific URL only after authorized configuration and a browser-safe token. Card rendering requires `findEligibleMethods(...).isEligible("advanced_cards")`. Card data enters PayPal-hosted components directly; ZONYX receives no full PAN/CVV and sends neither to its Edge Functions. The initial internal card form explicitly supports US billing ZIP codes; broader billing-country UX requires a reviewed extension.
- Card orders request `SCA_ALWAYS`. Server GET includes `fields=payment_source`; before the original atomic capture claim, the handler requires canonical card authentication `liability_shift=POSSIBLE` and rejects any supplied authentication status other than `Y`/`A`. Missing evidence, NO/UNKNOWN liability, failed/rejected/unresolved challenges fail closed. Client SDK success or liability claims are never sufficient payment evidence.
- This intentionally conservative internal risk policy does not accept merchant-liability exemptions for unenrolled/bypassed cards. Review actual sandbox/API responses and approve an explicit production risk policy before customer rollout; do not relax the policy merely to make a test pass.
- After successful SDK submission, only the existing server-side single-winner capture runs. Unknown submission/capture outcomes permit GET reconciliation only; verified completed capture still records rent and a separate disabled deposit, never confirms the trip. Card validation/authentication cancellation can retry the same persisted card order, without selecting another method or reserving another payment.
- `src/lib/paypal-sdk.ts` declares disabled Apple/Google wallet entries and an additional-wallet adapter contract. Future wallet approval adapters must use the same persisted order identity and protected server capture. Neither wallet is rendered or initialized; backend method validation rejects them until a separately reviewed adapter/gate exists.

### Default gates and account actions

`PAYPAL_ADVANCED_CARD_ENABLED` is a new setting, **unset = OFF**. It is required for card-token issuance, card order creation and new card capture. All existing PayPal/frontend/live/deposit gates retain their default-OFF behavior. No production configuration was read or changed.

Before live/customer activation, the account owner must:

1. Confirm approval/enabled status for Advanced Credit and Debit Card Payments / Expanded Checkout for the ZONYX live Business account and REST app, including supported card brands and vehicle-rental business use. Existing live REST keys and a saving-methods checkbox do not establish these capabilities.
2. Provision separate sandbox REST credentials securely in an isolated environment, with advanced card and browser-safe SDK token eligibility, for actual sandbox testing. No real credential values are requested, stored locally or committed by this implementation.
3. Complete genuine sandbox tests for valid/declined cards, 3DS success/cancellation/failure, account ineligibility, browser/network interruptions, reloads, signed webhooks and duplicate capture defenses. Current browser tests use synthetic SDK/API fixtures and do not prove account approval or PayPal acceptance of live requests.
4. Confirm the applicable PCI DSS validation/SAQ with PayPal/acquirer or a qualified assessor. Hosted fields reduce handling scope but do not eliminate merchant duties. Review checkout script security/CSP, accessibility, fraud policy, billing/SCA requirements and the processor privacy disclosure already shown by the form.
5. For Apple Pay, complete PayPal production onboarding and host/register the domain association file for every checkout domain. For Google Pay, complete its production onboarding/eligibility and any required Google integration approval. These are future adapters, not enabled payment methods in this release.
6. Independently verify security-deposit AUTHORIZE, consent/payment-source reuse, capture/void and finite authorization/renewal capabilities. The deposit adapter still does not exist and `canAuthorize` remains false. A rental card payment does not authorize stored-card or off-session use.
7. Before any production setting changes, approve the full release: both migrations, Edge Function/frontend deployment, matching live webhook/return origin/managed-inventory settings, advanced-card gate, live rental gate and customer rollout. Existing live client ID/secret should remain server-only and unchanged unless account approval requires a different app; any production change needs explicit authorization.

All previous rollout blockers remain: full local Supabase schema/pgTAP regression, baseline lint/type remediation, reviewed PayPal refund/cancellation/recovery operations, completed deposit lifecycle and customer-access rollout implementation. Paid internal bookings remain `pending_payment`.

### Follow-up files

Created: `src/pages/PaymentCheckout.tsx`, `src/lib/paypal-sdk.ts`, `src/lib/paypal-sdk.test.ts`, `e2e/paypal-card.spec.ts`, and the new additive migration above.

Modified: `src/pages/Booking.tsx`, `src/App.tsx`, `src/lib/payments.ts`, `supabase/functions/paypal-checkout/index.ts`, shared `payment-policy.ts` / `payment-policy.test.ts` / `payment-service.ts` / `paypal-client.ts` / `paypal-client.test.ts`, `scripts/test-payment-migration.mjs`, `playwright.paypal.config.ts`, and this report.

References: [SDK v6 card fields](https://developer.paypal.com/expanded/card-fields), [Expanded Checkout eligibility](https://developer.paypal.com/expanded/eligibility), [3DS response policy](https://developer.paypal.com/platforms/checkout/advanced/customize/3d-secure/response-parameters/), [Apple Pay onboarding/domain registration](https://developer.paypal.com/v5/apple-pay/integrate/), [Google Pay onboarding](https://developer.paypal.com/platforms/checkout/apm/google-pay/).

### Follow-up verification results

- 24 local unit-test files PASS; global network fetch blocked.
- 14 policy/client tests PASS, including isolated browser-safe OAuth scope and canonical 3DS rejection cases.
- 22 actual PostgreSQL fixture/migration checks PASS, including atomic method locking, nullable card approval URLs, wallet separation and client-role denial.
- 20 browser tests PASS: existing desktop/mobile agreement acceptance, embedded card entry/payment, eligibility/default-off behavior, SDK failure, secondary wallet approval, card/authentication failures, order mismatch, ambiguous capture/status recovery, reload recovery and ordinary-user exclusion. All SDK/API traffic is intercepted; external DNS is blocked. Desktop/mobile screenshots were visually reviewed; the hosted fields in these screenshots are synthetic fixtures, not evidence of live account capability.
- Production build PASS with a temporary external-fetch fixture for the existing SEO fleet step. No production network access was needed for the successful build. The generated sitemap was restored in the isolated repo and not included in this change.
- Deno checks PASS for the updated checkout/webhook and shared payment test modules; focused lint PASS.
- Whole frontend type check still has 87 baseline errors with no added diagnostics. Whole lint still has 30 baseline errors / 18 warnings. No full Supabase schema/pgTAP run or real sandbox card acceptance test has been performed.
- Original checkout/main is untouched; the 79 backed-up source files still match byte-for-byte (the backup's separate BASELINE.txt is metadata, not an original source file).

No real PayPal OAuth credential/token was retrieved or printed, and no financial API request was executed. No production migration, deployment, webhook registration, environment/secret modification or main merge occurred.

## PR #1 continuation — checkout recovery (October 6, 2026)

This continuation preserves the production gates. It does not claim that the
integration is ready to accept customer payments.

Changes:
- A lost card/wallet creation response now recovers the durable payment identity
  through a read-only checkout-config request. The status-check button remains
  available without creating a second order or switching providers.
- A canonical status of awaiting_approval permits retrying the same card payment;
  capturing/unknown/paid/failed/cancelled states remain locked against resubmission.
- Checkout identity changes clear the prior SDK session and hosted fields before
  initializing the next booking.
- Failed or timed-out SDK script loads no longer poison the module cache. A later
  initialization can retry the fixed provider URL; successful loads still lock
  the environment and share a single script between concurrent callers.
- Supplied empty/invalid 3DS authentication or enrollment results fail closed;
  the existing conservative liability-shift policy is retained.
- All shared payment responses now include Cache-Control: no-store.
- A GitHub Actions workflow runs unit, payment/migration, browser fixture tests
  and frontend compilation without needing PayPal secrets or financial requests.

Verification in the Work environment:
- 24 unit-test files passed, including SDK network-error/timeout recovery.
- 14 policy/client tests and 22 PostgreSQL payment fixture checks passed.
- 22 browser tests passed, including lost-create-response and safe status retry.
  SDK/API traffic is intercepted and all external browser DNS is blocked.
- Focused ESLint and git diff --check passed.
- Full npm production build passed, including the public fleet SEO step
  (14 canonical vehicle pages). The generated source sitemap was restored to
  its original version and excluded from this checkout change.
- Full frontend TypeScript still reports 87 baseline errors; none mention the
  changed checkout/SDK files.
- Read-only production inspection confirmed both PayPal tables and the expanded
  preparation RPC are absent. Neither paypal-checkout nor paypal-webhook is
  deployed, and neither PayPal migration appears in production history.

Required owner input before genuine end-to-end acceptance:
1. Provide a secure sandbox REST app/environment with Expanded Checkout and
   browser-safe client-token eligibility. Only ZONYX-PROD is currently connected;
   no separate sandbox credentials were accessed, requested in chat, or installed.
2. Confirm live Expanded Checkout approval for the ZONYX vehicle-rental business.
3. Confirm the security-deposit/booking-confirmation policy. Current code cannot
   authorize a deposit and deliberately leaves paid trips unconfirmed. A rental
   capture is not consent for a later deposit/off-session charge. Do not silently
   disable this protection to release the checkout.

After that input, work remains: genuine sandbox acceptance, deposit lifecycle and
customer access implementation, full schema regression, operational refund/recovery
verification, and the reviewed deployment/configuration release. No live transaction,
production mutation, migration, deployment, secret change, or main merge was performed
by this continuation.
## Isolated complete launch-schema regression

`npm run test:schema` now replays all 43 migrations from the explicit July
launch baseline, including provider-neutral PayPal and Expanded Card Checkout,
in a fresh network-free PostgreSQL 18.3/PGlite 0.5.8 database with pgTAP 1.3.4.
All 18 SQL suites pass: 17 legacy SQL assertion suites plus 46 individual
PayPal pgTAP assertions (63 top-level pgTAP checks in total).

Clean replay repairs restore omitted booking times/availability primitives,
make a legacy overload revoke conditional on existence, and skip the one-time
historical correction when its target reservation is absent. Existing approved
source-hash checks are preserved. Tests now use synthetic accepted evidence
and current explicit settlement/operative-agreement contracts. The runner is
part of the PayPal CI workflow. See scripts/db-regression/README.md for the
bootstrap scope, pinned upstream pgTAP source and runtime limits.

This verifies complete current-schema SQL constraints, triggers, RPCs and RLS;
it does not install GoTrue/Storage/PostgREST services or prove native Supabase
PostgreSQL-version compatibility. Historical pre-launch migrations are not a
standalone bootstrap and are superseded by the launch baseline. No production
project, deployment, payment provider or financial transaction is involved.
