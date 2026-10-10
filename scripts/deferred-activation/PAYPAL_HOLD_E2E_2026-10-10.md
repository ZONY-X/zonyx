# Genuine PayPal sandbox card checkout and authorization evidence — October 10, 2026

Result: the synthetic October 10–11 booking completed the real PayPal sandbox card flow, rental capture, separate authorization-only deposit, atomic DB confirmation and browser reload recovery. This is not a production activation or a simulated-provider-only claim.

## Confirmed booking

- Supabase project: `pvowzjqimikcoyjwclez`; synthetic vehicle: `0cbbe540-904b-4c68-a5c1-86fee43b5662`.
- Booking `e85b1230-8594-4db2-87be-c34d2d0ed885`, reservation `ZNX-000016`, October 10–11, 2026.
- Immutable accepted agreement `13858d66-c02a-4dec-8e00-1635f68aef0b`.
- Rental payment `c6d70197-a00b-4424-a127-8154b2f6c9d6`; PayPal CAPTURE order `1LS20720ET130115J`; completed capture `6KM7909800384145P`; USD 1.08; DB paid at `2026-10-10T14:53:31.932411Z`.
- Separate deposit `fc8f915d-0004-4aee-b2af-09a54cfb0252`; AUTHORIZE order `2FG01788DN8392441`; authorization `0CL84311X74985938`; USD 1.00 authorized; **deposit captured amount USD 0.00**.
- Authorized `2026-10-10T14:53:55Z`; expiration `2026-11-08T14:53:55Z`; conservative honor period ends `2026-10-13T14:53:55Z`, covering return plus one day for inspection.
- DB booking `confirmed`, rental `paid`, deposit `authorized`, operation `complete`. Reload displayed persisted confirmation with no second provider payment POST.
- Authentic signed rental webhook: `WH-01F37842D8838912E-6W218691TN0131326`, PAYMENT.CAPTURE.COMPLETED, received `2026-10-10T14:53:50.362093Z`.

## Failure, recovery, coverage and release

The earlier synthetic paid rental `30b2740d-6611-48a9-8496-c557b97ea86c` was used to test deposit authentication independently. Public failed-3DS fixture produced canonical enrollment Y / authentication N / liability NO. Order `3PS69442PP727790Y` remained CREATED; deposit `2709d722-5f2e-4318-bb29-ad3f07479600` stayed awaiting approval with no authorization and no capture. Canonical GET verified this before reapproval of the **same order** using the successful public sandbox fixture.

Authorization `2NF707775L4314520` then succeeded. The October 14–15 reservation remained unconfirmed because its return/inspection exceeds the initial honor period. An authenticated synthetic-only release sent one authorization VOID request, verified HTTP 204 and canonical VOIDED status, persisted `voided`, captured zero deposit funds, preserved original rental capture `4H235147CP5152204` and paid timestamp, and marked reconciliation required. No second rental capture was attempted.

Authentic postback-verified authorization webhooks, stored once:

- `WH-7U949098CT326593C-7UR61398XV710622B`, PAYMENT.AUTHORIZATION.CREATED, `2026-10-10T15:01:19.985346Z`.
- `WH-2RG51444NT977515U-5DC13258AC745900Y`, PAYMENT.AUTHORIZATION.VOIDED, `2026-10-10T15:02:00.634374Z`.

The existing sandbox webhook `2WU43078HT5782300` now subscribes to authorization created/voided as well as its existing checkout/capture events. Signature verification precedes reconciliation; canonical order identity, intent, amount and authorization identity are checked. Deposit orders containing captures are rejected. Duplicate finalization/void is idempotent; unknown create/authorize/release responses cannot redispatch.

## Regression evidence

- 24 local unit-test files passed.
- 47 complete migrations, 20 SQL suites, 117 pgTAP assertions passed in isolated PGlite PostgreSQL.
- Payment regression passed, including 20 policy/client cases, 22 earlier migration checks, 15 PayPal rental handler cases and 7 new deposit handler checks, alongside existing Stripe, signature and diagnostics tests.
- 25 browser regressions passed, including deposit confirmation, insufficient coverage and read-only recovery after an uncertain authorization. These browser/provider fixtures are **simulated**, separate from the genuine sandbox evidence above.
- Frontend compilation, targeted lint and whitespace checks passed. CI is verified against the final remote PR head, not an earlier SHA.

## Teardown and production assessment

At `2026-10-10T15:06:21Z`, five temporary TEST gates were saved false and verified after reload: PAYPAL_PROVIDER_LOCK_READY, PAYPAL_RENTAL_CHECKOUT_ENABLED, PAYPAL_ADVANCED_CARD_ENABLED, ZONYX_INTERNAL_TEST_ENABLED and PAYPAL_SANDBOX_DEPOSIT_ENABLED. False SHA256: `fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa`. LIVE rental and the legacy deposit gate remain false. Credentials were not changed or exposed.

The quota banner specifies restrictions from October 13 if the organization remains over quota. It did not block current SQL, function deployments or genuine sandbox provider/webhook tests. No paid upgrade was made.

**Production activation is NOT ready.** The verified path deliberately permits only the named sandbox and internal testers. LIVE/customer rollout, operational transitions after confirmation, normal administrator release/cancellation/refund handling and authorization renewal/reapproval for longer trips require a separate implementation/review and explicit production authorization. Wallet E2E is not declared passed. The expired Stripe app TEST key remains a separate Stripe integration limitation; connector-created Stripe payments are not treated as application settlement. No production configuration/deployment, merge, live card charge or infrastructure cost was initiated.

## Read-only reproduction

```sql
SELECT b.id,b.trip_status,p.id,p.state,p.amount_cents,p.order_id,p.capture_id,p.paid_at,
 d.status,d.operation_state,d.provider_order_id,d.provider_authorization_id,
 d.amount_cents,d.captured_amount_cents,d.authorized_at,d.expires_at,d.honor_period_ends_at
FROM bookings b JOIN booking_payments p ON p.booking_id=b.id
JOIN booking_security_deposits d ON d.rental_payment_id=p.id
WHERE b.id='e85b1230-8594-4db2-87be-c34d2d0ed885';
SELECT event_id,event_type,received_at FROM payment_webhook_receipts
WHERE payment_id IN ('c6d70197-a00b-4424-a127-8154b2f6c9d6','30b2740d-6611-48a9-8496-c557b97ea86c')
ORDER BY received_at;
```
