# Isolated sandbox preparation — no production deployment

Use a separate Supabase test project (or local Supabase stack), never ZONYX-PROD.
No production data, credentials or browser sessions are copied. Rebuild the launch
schema from the regression baseline and use synthetic users, agreements, bookings
and vehicles. Deploy matching PayPal handlers and stripe-checkout-sandbox only
there. Route test Stripe checkout explicitly to that isolated adapter. Do not
replace production stripe-checkout. The main-branch merge route is prohibited.

stripe-checkout-sandbox requires a Stripe sk_test_ key, explicit sandbox mode,
provider-lock readiness and PAYPAL_SANDBOX_BOOKING_IDS allowlist. Reservation occurs
before both existing-session reuse and new-session creation. An allowlisted booking
must be created fresh after isolation; never allowlist an imported production booking
or a booking with an unknown earlier Stripe attempt. Keys/IDs alone do not prove
that an in-flight unrecorded legacy session cannot settle. Production activation
requires draining/reconciling legacy sessions or a reviewed fresh-booking cutover.

Configuration in isolated environment only:
- PAYPAL_SANDBOX_CLIENT_ID / PAYPAL_SANDBOX_CLIENT_SECRET: matching sandbox app.
- PAYPAL_WEBHOOK_ID: webhook under that sandbox app, never LIVE listener ID.
- PAYPAL_ENVIRONMENT=sandbox; PAYPAL_LIVE_RENTAL_PAYMENT_ENABLED=false.
- PAYPAL_PROVIDER_LOCK_READY and PAYPAL_RENTAL_CHECKOUT_ENABLED stay false until
  native concurrency validation below passes. Cards need PAYPAL_ADVANCED_CARD_ENABLED.
- PAYPAL_MANAGED_VEHICLE_IDS: only synthetic approved vehicle UUIDs.
- PAYPAL_SANDBOX_BOOKING_IDS: only newly created synthetic booking UUIDs.
- PAYPAL_CHECKOUT_RETURN_ORIGIN: exact test origin, no path/trailing slash;
  HTTPS or sandbox localhost/127.0.0.1.
- Internal tester enabled/email, profile tester/admin flag, accepted internal-test
  agreement and valid driver/vehicle eligibility. Never copy production test code.
- Isolated frontend VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED=true and isolated
  Supabase URL/key; production frontend remains unchanged. Deposit gate false.

Passed offline SQL cases: Stripe-first durable identity/retry; Stripe-first rejects
PayPal; PayPal-first rejects Stripe; legacy attached Stripe session rejects PayPal;
method/environment conflict; single capture claim; same capture finalization retry;
wrong/different capture rejected; paid evidence persists; overlapping PayPal capture
rejected. Provider clients use mocks. Offline PGlite serializes a single connection,
so these are state-machine tests, not proof of concurrent PostgreSQL transactions.

Required BEFORE genuine sandbox payments (still pending):
1. Native PostgreSQL two independent sessions race Stripe/PayPal reservations on
   the same booking in BOTH orderings; loser waits then rejects; exactly one row.
2. Race two capture claims; only one succeeds. Race capture/cancellation/webhook
   and retries; permanent paid identity cannot be overwritten or trigger recapture.
3. Pause/mock provider transport after Stripe creation but before attachment;
   PayPal must remain rejected; retry uses same Stripe idempotency key and session.
   Inject PayPal create/capture timeouts; recovery queries existing identity and
   never dispatches a new payment. Exercise signed and duplicate webhook delivery.
4. Test concurrent overlapping bookings across BOTH providers. Current vehicle
   advisory capture lock covers PayPal, not legacy Stripe settlement. This is an
   unresolved cross-provider inventory/settlement boundary; do not call it validated.
5. Run actual Edge Runtime/auth/RLS integration and sandbox SDK token eligibility
   initialization without order/capture. Provider account eligibility is manual.

No genuine sandbox transaction is authorized by this document until all required
checks pass. No LIVE activation follows automatically. Native runtime and genuine
provider credentials were unavailable in the current environment.

Version audit: production Stripe v23 and PayPal v4 exported source/bundle hashes,
JWT mode, entrypoints and updated_at equal prior v20/v1 preparation snapshots.
Logs expose runtime streams, not management deployment audit events; focused
search found none. Version-only increments (+3 each) are consistent with metadata
revision/refresh after settings activity, but actor/cause is NOT verified.

## 2026-10-08 gate-OFF validation

Sandbox only: pvowzjqimikcoyjwclez. No production reads/writes, secret value
retrieval, provider requests, orders, captures, deploys or gate changes occurred.
The user configured a fresh Stripe test key manually; its value was not inspected.

- Deployed PayPal checkout/webhook and Stripe sandbox adapter are ACTIVE v5.
  Bundle hashes and updated_at still match reviewed v1/v4 snapshots.
- Both deployed PayPal POST probes return 503 at the readiness gate. Source puts
  this check before auth, serviceClient and PayPalClient. Full active auth/provider
  integration cannot be validated with that gate OFF.
- `node --experimental-transform-types scripts/test-paypal-handlers.mjs`: 10 PASS.
  Runs committed handler bodies in Node VM with injected fake dependencies and
  forbidden networking. Covers OFF short circuit, bad signature before DB,
  unknown order redelivery, duplicate event skip, receipt failure redelivery,
  refunds/reversals review only, capture timeout followed by read-only recovery,
  paid retry and missing order identity. Not genuine Deno/PayPal verification.
- Existing payment policy/client suite: 16 PASS; migration integration: 22 PASS.
- Native overlap counterexample reproduced: a pending-payment booking with a
  synthetic Stripe paid record does NOT prevent an overlapping PayPal capture
  claim on another booking for the same vehicle/time. All fixture writes rolled
  back. Same-booking provider lock does not solve shared vehicle settlement.
- Prior native 54 assertion run remains historical evidence. This turn's rerun
  returned expired request state, so it is NOT counted as freshly passed.
- Sandbox fixture table now has RLS enabled and anon/authenticated grants revoked;
  service_role retains access. Verified payment_rows=0 and webhook_rows=0.
- Advisors report inherited launch-schema search_path and executable definer
  notices; they require function-by-function review. RLS-without-policy on the
  restricted fixture is intentional deny-by-default. No production inference.

STOP before any payment: coordinated overlapping-booking protection must span
Stripe session creation/reuse, uncertain outcomes and settlement, plus PayPal
capture, under one shared durable inventory claim and lock ordering. Do not simply
add provider='stripe' to the PayPal query: Stripe can still initiate/settle after
PayPal's check. Preserve production Stripe and design/test this in sandbox only.

Genuine signed-webhook verification is still pending. PayPal's simulator events
cannot use the current verify-webhook-signature postback API, per official docs:
https://developer.paypal.com/api/rest/webhooks/rest/
Do not label a mocked SUCCESS response as authentic signature validation. With
all activation gates OFF the deployed listener intentionally rejects even authentic
events before verification. A separate reviewed non-financial diagnostic listener
or later expressly authorized isolated activation is required; no payment is
necessary/authorized in this validation turn. SDK token/account capability checks
also remain unverified. Keep gates OFF and do not send simulator events expecting
this deployed listener to process them.

## Shared inventory protection implemented — 2026-10-08

The preceding overlap blocker is fixed for the coordinated sandbox adapters.
This does not authorize production application of the new migrations.

PR migrations (both required):
- 20261008191404_shared_vehicle_payment_claims.sql
- 20261008192435_shared_vehicle_lock_order_hardening.sql

Applied ONLY to pvowzjqimikcoyjwclez, with recorded history versions respectively
20261008191818 and 20261008192509. Existing production checkout/webhook source,
production schema, frontend, secrets, gates and main were not touched.

`vehicle_payment_claims` stores a durable booking/payment/vehicle/time interval.
Both providers acquire it through reserve_rental_payment_provider before dispatch
or session reuse. Booking -> payment -> vehicle lock ordering is consistent.
Competing overlapping bookings and legacy/unknown earlier provider attempts fail
closed. Accepted financial and schedule terms cannot move after a claim exists.
Claims persist through failure, timeout, cancellation and settlement; there is no
automatic TTL, refund release, customer release or administrative release RPC.
This conservative boundary can strand inventory until a separately reviewed
reconciliation/release process exists. It is suitable only for isolated testing.

Stripe sandbox creation has a one-time DB dispatch claim and a stable request ID.
An unknown outcome cannot send another POST after idempotency retention expires.
Known sessions are read canonically and attached idempotently; different identities
are refused. New stripe-webhook-sandbox verifies a timestamped HMAC, requires
livemode=false, GETs the canonical test session and calls a service-only settlement
RPC. It never creates deposits, confirms trips, authorizes holds or moves money.
Both Stripe adapters are additionally bound to this exact sandbox Supabase URL.
Production stripe-checkout and stripe-webhook remain unchanged.

Sandbox deployment verification (exported source exactly matches local source):
- stripe-checkout-sandbox ACTIVE v6, bundle
  e1c39a9a5d9a5326a9a0f181c3a640181963908ec9f33bc6dda066af7253dc4c
- stripe-webhook-sandbox ACTIVE v1, bundle
  ba7e9e25a5ab5cf221ae6cc912fbd190041d64fdef56b593b735dab943b6b109
- PayPal checkout/webhook source unchanged from reviewed v5 deployment.
All four sandbox POST probes return 503 before credential/database/provider access.
No gate or secret value was read/changed by the agent. No provider order, payment,
capture, authorization or refund was sent.

Verification:
- Full offline schema: 45 migrations, 19 suites, 94 pgTAP assertions PASS.
- 24 local unit-test files PASS; payment-policy/client 16 and migration 22 PASS.
- Mocked committed PayPal handler body 10 scenarios PASS; sandbox Stripe handler
  body 5 scenarios PASS; six local HMAC signature assertions PASS; focused lint
  and git diff whitespace check PASS.
- Native independent transactions: Stripe-first overlapping PayPal reservation
  rejected; PayPal-first overlapping Stripe reservation rejected. One durable
  reservation per tested window. Separate non-overlapping windows coexist.
- Native concurrent Stripe dispatch: first won, second refused dispatch.
- Native concurrent PayPal capture claims: one winner, second rejected.
- Native Stripe recovery/attachment/settlement assertions: stable session identity,
  wrong amount rejected, duplicate settlement idempotent, different capture refused,
  no trip confirmation PASS (rolled back).
- Native concurrent duplicate PayPal settlement retained one capture identity;
  paid cancellation rejected; external reversal flag survives delayed completion.
- Client roles cannot read/write claims or invoke Stripe settlement; RLS enabled.
- Full native pgTAP transport rerun returned expired request state; it is not claimed
  as a native full-suite pass. Targeted native tests above returned confirmed results.

Retained test evidence: four new synthetic bookings/agreements for 2091/2092,
two shared claims and two synthetic neutral payment rows (Stripe creating and
PayPal paid with literal synthetic-native-* IDs), one disabled synthetic deposit,
zero provider webhook receipts. These are database-only simulations, not provider
transactions. Do not allowlist these historical fixtures for genuine payment tests.

Remaining before a first controlled sandbox payment:
1. Manual Stripe TEST/Sandbox webhook setup (no LIVE account changes): Workbench
   > Webhooks > Create an event destination > Your account > Snapshot payload.
   Subscribe checkout.session.completed and checkout.session.async_payment_succeeded.
   Choose Webhook endpoint, using
   https://pvowzjqimikcoyjwclez.supabase.co/functions/v1/stripe-webhook-sandbox
   Securely enter that destination's whsec_ signing secret as
   STRIPE_SANDBOX_WEBHOOK_SECRET in ZONYX-SANDBOX only. Never paste it into chat.
   Do not send/trigger any payment event yet; all gates stay OFF.
   Official flow: https://docs.stripe.com/webhooks
2. Confirm sandbox PayPal wallet/card eligibility in its app/account. Embedded
   cards require Expanded/Advanced Card Payments, SDK token eligibility, applicable
   supported-country/currency/card capability and 3DS eligibility. Vehicle-rental
   merchant approval remains a separate LIVE prerequisite, not a sandbox guarantee.
3. Genuine PayPal signature postback, Stripe canonical settlement, SDK token
   eligibility and active auth/RLS/driver checks remain unverified with gates OFF.
   Use a reviewed non-financial diagnostic path or separately authorize narrow
   sandbox activation for initialization; do not claim mocked success as authentic.
4. Prepare fresh synthetic active vehicle/booking, accepted internal-test agreement,
   eligible synthetic driver linked to the recreated tester UID. Do not copy real
   identity documents/production agreements or reuse the race fixture payments.
5. At a later expressly authorized sandbox activation only: PAYPAL_ENVIRONMENT=sandbox;
   PAYPAL_LIVE_RENTAL_PAYMENT_ENABLED=false; ZONYX_INTERNAL_TEST_ENABLED=true;
   ZONYX_INTERNAL_TEST_EMAIL=sandbox-tester@example.invalid; tester profile flag true;
   PAYPAL_MANAGED_VEHICLE_IDS=fresh synthetic vehicle UUIDs;
   PAYPAL_SANDBOX_BOOKING_IDS=fresh synthetic booking UUIDs;
   PAYPAL_CHECKOUT_RETURN_ORIGIN=http://127.0.0.1:4175;
   isolated frontend Supabase URL/key and VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED=true.
   Coordinate PAYPAL_PROVIDER_LOCK_READY=true and PAYPAL_RENTAL_CHECKOUT_ENABLED=true
   only after non-financial initialization/verification. Card gate stays false unless
   card capability checks pass; all LIVE/deposit/customer gates remain false.
6. Obtain explicit authorization for the bounded sandbox payment case before any
   create/capture request. Genuine signed/duplicate event delivery and final receipt
   reconciliation must then be observed. Nothing here authorizes a LIVE transaction,
   production deployment, merge or customer rollout.

## Authenticated non-financial diagnostics — 2026-10-08

Deployed sandbox-payment-diagnostics ONLY in pvowzjqimikcoyjwclez, ACTIVE v3,
bundle 402e58a03f546e80b3821f7c2498294beea7ebd7021d0ed9a208ead4d287083f.
Exported source matches the PR source. It refuses other projects, LIVE mode and
any enabled payment gate. Tester diagnostics require the recreated user's valid
JWT, internal-tester flag and non-admin profile. Public signed-event diagnostics
require a valid provider signature; they never persist or process payment events.
No activation gate was changed; no secret value was retrieved, printed or modified by the agent.
Only deployed server code uses sandbox credentials internally for normal OAuth,
SDK token issuance, webhook registration GET and genuine signature verification.
No privileged REST token or browser SDK token is returned by this function.

Prepared synthetic driver fixture for the recreated tester using its authenticated
RPC: Synthetic Sandbox Tester, synthetic DOB/region/expiry. This is test-only
self-attestation, not verified real identity or rental eligibility. Its authenticated
get_my_driver_eligibility response is eligible_self_attested for 2026-10-15.

Confirmed through the actual signed-in local browser and deployed backend:
- All payment gates OFF; valid tester session; internal tester true; admin false.
- Authenticated driver RPC eligible_self_attested.
- PayPal sandbox credentials accepted by genuine OAuth endpoint.
- Browser-safe SDK token issuance supported by the configured sandbox app.
- PayPal webhook exists under the matching app, has the correct sandbox listener
  URL and all seven required subscribed events.
- No card component was initialized and no wallet/card/payment session created.
  Card-method eligibility, account Expanded Card Payments approval and actual 3DS
  behavior are not established merely by successful SDK token issuance.

The four normal payment POST handlers remain HTTP 503 before provider/database
access. Anonymous diagnostic checks return HTTP 401. No new payment, deposit or
webhook receipt rows were created; prior synthetic race evidence is unchanged.
Five new diagnostic handler scenarios and ten PayPal RSA/CRC32/raw-body/certificate URL
assertions passed, plus the existing npm test:payments suite and focused lint.
Synthetic keys/signatures in tests do not prove genuine provider delivery.

Local tester UI is stored under scripts/deferred-activation/sandbox-diagnostics.html;
its temporary public copy is removed after checking. It is restricted to exact
localhost/project and was never deployed as a frontend. No production change,
merge, financial transaction, authorization, capture or refund occurred.

NEXT MANUAL ACCOUNT ACTIONS — all gates remain OFF:
1. PayPal Developer > Tools > Webhooks Simulator. Use only a simulated notification
   (no checkout, order or transaction). Listener URL:
   https://pvowzjqimikcoyjwclez.supabase.co/functions/v1/sandbox-payment-diagnostics
   Select PAYMENT.CAPTURE.COMPLETED and send the simulator notification. Record
   delivery status and safe response only; do not share credentials or raw headers.
   The diagnostic verifies the original body and PayPal RSA signature using the
   public PayPal signing certificate and simulator WEBHOOK_ID. It returns
   processing=signed_simulator_verification_only and explicitly marks registered
   app postback verification still pending. Do NOT alter PAYPAL_WEBHOOK_ID for this.
2. Stripe test Workbench > Webhooks > existing sandbox destination: to validate a
   genuine signature using the already configured destination signing secret,
   temporarily direct that SAME test destination to the diagnostic URL above.
   Send a sample Snapshot notification only if the Dashboard supports doing so
   without creating/paying an order, PaymentIntent or checkout. Do not use
   `stripe trigger`, checkout completion or any payment-generating fixture command.
   Observe HTTP 200 plus verified=true, then restore the original test destination
   URL ending /stripe-webhook-sandbox. Do not rotate/copy its secret into chat.
   If only payment-generating test actions are offered, stop; that needs separate
   authorization and remains outside this task.
3. In the PayPal SANDBOX app/account feature settings, manually confirm Advanced/
   Expanded Card Payments availability and supported sandbox card/3DS capability.
   Do not expose the app credentials and do not change LIVE app features.

Real registered-app PayPal signature POSTBACK and actual Stripe canonical paid
session reconciliation remain pending unless a pre-existing genuine sandbox event
can be safely redelivered. A PayPal simulator event is cryptographically signed but
not an app event; PayPal explicitly does not support postback verification of it.
https://developer.paypal.com/api/rest/webhooks/rest/

Any later first controlled sandbox payment still needs separately authorized,
scoped activation; fresh synthetic booking/vehicle, accepted internal-test agreement,
allowlists, return origin and internal tester environment settings; browser SDK/card
eligibility checks; and explicit payment-case authorization. Production stays OFF.
