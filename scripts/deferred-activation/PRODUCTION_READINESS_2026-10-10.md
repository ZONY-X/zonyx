# PayPal production readiness — 2026-10-10

Production remains OFF. This change prepares a restricted card-only release; it does not authorize deployment, LIVE transactions or a general rental rollout.

## Implemented

Customer route and hosted card fields, verified rental capture followed by separate deposit authorization, immutable accepted amounts, authoritative ownership and roles, provider isolation and inventory locking. Wallet creation/capture is disabled. New customer, deposit, operations and webhook gates default OFF.

The complete return plus 24-hour inspection deadline must fit within 71 hours at checkout (one-hour reserve inside the three-day authorization honor period). Long and advance rentals are blocked before rental order creation/capture. The 29-day authorization validity is not treated as guaranteed coverage; elapsed honor periods require reconciliation and cannot confirm a trip. No automatic renewal, saved card, deposit capture or damage charge is enabled.

Durable cancellation operations validate policy amounts server-side, void the deposit, refund the original rental capture, verify canonical provider evidence and atomically cancel/release availability. Stable request IDs and database claims prevent duplicate financial writes. Unknown outcomes recover by GET and exact authenticated app-event discovery, never blind refund/capture retry. Pending or conflicting evidence keeps the reservation locked. Return/inspection release is restricted to host/admin with no unresolved charges. Original capture history survives cancellation/refund.

## Verification evidence

* Genuine sandbox booking ZNX-000016: payment c6d70197-a00b-4424-a127-8154b2f6c9d6, rental capture 6KM7909800384145P, USD 1.08; separate authorization 0CL84311X74985938, USD 1.00, captured deposit USD 0.00. Booking-to-confirmation passed in the preceding verified head.
* Genuine cancellation and read-only recovery: operation af4bbb68-e525-4d1e-afa9-52eb1dd3a4ef; refund 7L350451RN5913335 COMPLETED USD 1.08; deposit VOIDED with zero capture; booking e85b1230-8594-4db2-87be-c34d2d0ed885 cancelled, original paid capture retained, inventory released at 2026-10-10T15:52:13.322054Z. Lost refund identity recovered from authentic app event history plus canonical refund GET; refund POST was not repeated.
* Authentic signature-verified void event WH-5GC46382694738730-3WV14221UG319533Y persisted once. Refund event redelivery verification is recorded in the final external evidence report.
* 24 unit-test files, zero failures; 48 migrations, 23 SQL suites, 201 pgTAP assertions; 28 isolated browser tests. Browser customer flow and failure/3DS/recovery scenarios use intercepted provider responses, not genuine additional transactions.
* Payment simulations: 20 policy/client cases, 22 migration checks, 15 handler cases, 7 deposit cases, 10 operation cases, 8 customer-access checks, existing Stripe/signature/diagnostic regressions. Expiration, long-rental rejection, return/inspection release and concurrent requests are SQL/isolated simulations; no elapsed real 29-day hold or LIVE test is claimed.
* Full frontend and public-fleet SEO build succeeds; changed frontend files pass lint. Sandbox lifecycle migration and PayPal functions deployed only to pvowzjqimikcoyjwclez.

## Remaining production blockers

1. LIVE app credentials, advanced-card entitlement, matching registered webhook ID and production origin/inventory must be verified without a transaction before activation. Presence of encrypted secret names proves neither validity nor entitlement. No production credential was revealed or modified.
2. Production does not contain the recent deposit/lifecycle migrations or new activation gates. Reviewed migrations/functions/frontend release and configuration require separate production authorization. Sandbox diagnostics must not be deployed to production.
3. Long/advance rentals, authorization renewal and itemized damage capture are unsupported and blocked. A restricted short-rental policy needs explicit business acceptance; general rental readiness requires a separately designed and validated renewal/collection workflow.
4. Wallet is unvalidated and disabled. Stripe integration is outside this PayPal acceptance evidence; do not enable either as an unvalidated fallback.
5. Supabase organization quota warning states projects may be restricted from October 13 if usage remains over quota. It does not block today's successful SQL, function deployment or provider tests. Production continuity requires a read-only usage/remediation review before launch; no paid upgrade was performed.
6. Provider expiration/redelivery coverage and operational monitoring must be enabled and checked during an approved release. Customer email delivery is not demonstrated by the database/UI confirmation; no real customer notification was sent.

## Controlled activation plan — separate approval required

1. Pin and review the final PR head and its green CI. Accept the restricted itinerary policy and exclusions. Confirm refund policy and inspection operating hours.
2. Verify LIVE app entitlement/webhook configuration privately, production driver eligibility and managed inventory, operational contacts and quota headroom. Stop on an unverifiable prerequisite.
3. After explicit approval to merge/deploy, apply reviewed migrations and deploy checkout/deposit/operations/webhook functions and customer frontend with payment creation still OFF. Do not deploy sandbox diagnostics. Verify RLS, role grants, provider locks, return deadlines and webhook subscriptions using non-financial checks.
4. Enable reconciliation/operations independently so disabling new checkout does not disable recovery. Activate card-only creation gates only after separate explicit LIVE activation approval. Keep wallet, legacy deposit capture, renewal and other unvalidated methods OFF.
5. Any first LIVE payment requires its own explicit authorization. Observe capture, separate hold, confirmation, webhook and ledger before widening rollout. On anomalies disable new creation, preserve reconciliation, investigate existing identities and do not retry uncertain financial requests.

No merge, production deployment, production configuration mutation, LIVE activation, real-money transaction or infrastructure purchase was performed.
