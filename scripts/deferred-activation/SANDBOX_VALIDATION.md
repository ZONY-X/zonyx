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
