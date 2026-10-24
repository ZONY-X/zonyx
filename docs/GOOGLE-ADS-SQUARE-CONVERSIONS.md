# Square confirmed-booking measurement (issue #20)

## Production entry points

- Checkout stays at `https://www.gozonyx.com/booking/square?bookingId=…&agreementId=…`.
- Only the existing checkout server response `bookingConfirmed: true` redirects to `https://www.gozonyx.com/booking/confirmed?bookingId=<booking UUID>`.
- Confirmation verification endpoint: `https://fazzuetfwwfiqehpnjky.supabase.co/functions/v1/booking-conversion` (authenticated POST `{ "bookingId": "<UUID>" }`).
- `/booking/success` is a legacy alias to the same verified component. A Stripe `session_id`, a URL visit, and query-string amounts cannot confirm a booking or emit a purchase.

**Never configure a purchase conversion from a visit to `/booking/square`, `/booking/confirmed`, or `/booking/success`.** Even a confirmation-only UI must not turn an arbitrary page visit into a conversion. Use the event below.

## Authoritative evidence and value

The new endpoint only reads, using the visitor's validated JWT and existing RLS. It additionally checks renter ownership (an admin/host inspection does not count), then the existing `get_provider_rental_payment_receipt` RPC. For a conversion it requires `bookingConfirmed === true`, paid live Square rental payment, persisted capture ID/date, matching captured amount/currency, no refunds and no reconciliation flag. Verified sandbox bookings retain their confirmation display and payment summary, but return `purchase: null` and cannot create Google revenue. No call to Square, no service key, writes, migrations, payment operations, emails, or reservation changes.

`purchase.value` is the server-verified captured **rental payment amount / 100** in the server currency. It does not include the separate deposit authorization. The single item represents the complete paid rental, including the existing rental checkout fees/taxes; it is not a net-commission/revenue figure. `transaction_id = zonyx_square_<booking payment UUID>` is stable for this booking/payment. No customer name, email, card, agreement token, or reservation number is sent to Google.

A same-tab confirmation handoff is armed only after the Square checkout's server confirmation. Direct navigation cannot emit purchases. Handoffs and paid evidence expire for measurement after 24 hours, preventing historical backfill. Browser persistence plus Web Locks suppress repeated sends/reloads/tabs. Google receives the stable transaction ID for destination-side deduplication across browsers. Clearing browser storage can cause a repeat event submission; Google transaction-ID deduplication remains necessary. Browser blocking or navigation/network failure can lose delivery; queuing is not proof Google received it. Existing payment webhook recovery and booking reconciliation are unchanged; this is browser measurement, not a guaranteed server-to-server/offline conversions pipeline.

## Real Google account verified during implementation

- Authorized email: **zoeysnp@gmail.com** (not zoeysnp1@gmail.com).
- Google Ads customer: **579-424-4019**.
- Existing GA4 account: **413378187**, property **560671137**, property name **www.gozonyx.com**.
- Actual measurement ID displayed by GA4: **G-DDGNYMF7DG**. Configured as `VITE_GA4_MEASUREMENT_ID` in the existing Vercel project's Production environment.
- Ads currently redirects the conversions panel into the unfinished Smart Campaign setup. The purchase wizard offers a URL rule, which is unsuitable and was not applied. No ad has been published or budget changed by this work.

## Finish Google Ads (no campaign publication needed for testing)

1. Open the existing account: https://ads.google.com/aw/conversions?ocid=8625496693&authuser=1 . If redirected to Smart Campaign onboarding, use the account's supported full conversion setup / Expert interface before proceeding; do not work around this with a page-URL purchase rule.
2. Recommended GA4 route: open https://analytics.google.com/analytics/web/?authuser=1#/a413378187p560671137/admin . Resolve the user's own email-preferences notice if shown. Verify the existing Google Ads link under Product links → Google Ads links targets **579-424-4019**. Configure/confirm `purchase` as a key event; do not create a page-view-based event called purchase.
3. In Google Ads → Goals → Conversions → Summary → New conversion action → Import → Google Analytics 4 → Web, import **purchase** from property **560671137**. Use the dynamic value/currency; category **Purchase**, count **Every**. Use this as the single primary booking purchase conversion. Do not also make a direct Ads tag and imported GA4 event primary, which would double-count bidding goals. Link with the consent policy and applicable Google requirements verified before enabling ad attribution.
4. Alternatively create a website conversion action with manual code (not URL matching), then copy its real `AW-…` ID and conversion label into Vercel Production variables `VITE_GOOGLE_ADS_CONVERSION_ID` and `VITE_GOOGLE_ADS_CONVERSION_LABEL`, and rebuild/promote. Do not infer these from the customer ID or campaign ID. The implementation then sends a separate Google Ads `conversion` event with the same server value/currency/transaction ID. Leave the GA4 import secondary if this direct action is primary.
5. Google measurement starts denied. A visitor must explicitly allow measurement; refusing must produce no Google tag load or purchase event. Advertising storage and advertising user-data consent additionally remain denied unless the visitor explicitly checks the separate, initially unchecked Google Ads measurement checkbox. Analytics consent alone never enables advertising measurement. For GA4 import, only explicit advertising consent makes advertising attribution eligible; the actual Ads link/import still requires verification. Ad personalization stays denied.
6. Verify the actual deployed flow with Tag Assistant / GA4 DebugView (or Realtime) and Ads diagnostics. Inspect an authorized future genuine confirmed booking, without creating a payment solely for testing. A page visit, pending/failed charge, a deposit alone, a renewal-only payment and direct confirmation navigation must not emit booking purchase. Reload after success must not emit another purchase. Never synthesize a production purchase for an unpaid booking.
7. Only after verifying Google receipt and imported Ads action should the campaign be completed. The issue sets a **$25 total maximum**; this is not a $25 daily budget. This implementation does not publish or fund ads.

## Retired Stripe checkout

Removed the unused `src/lib/stripe.ts` session API, retaining the unchanged 12% / 8% shared pricing constants in provider-neutral `rentalPricing.ts`. Replaced the old static Stripe success message. Both live and sandbox Stripe checkout endpoints refuse new/reopened sessions; the sandbox implementation no longer imports credentials, contacts Stripe or writes booking/provider reservations. No Stripe SDK dependency existed to remove.

Historical Stripe payment columns, ledger records, refund/reconciliation/authorization handlers, signature verification and webhooks are deliberately preserved. Historical funds must remain manageable; this is not deletion of accounting evidence. Square/PayPal configuration, provider locks, card storage, deposits, renewal links, contracts and payment/webhook implementations are unchanged.

## Focused validation / deployment

- `npm run test:conversions`: owner/read-only handler contract (24 scenarios), retired endpoints, browser conversion/consent/deduplication scenarios. All Google/Square endpoints intercepted with synthetic data.
- `npm run test:square`: existing handler/SQL lifecycle, signed webhook, idempotency, reconciliation, void/refund, immediate/advance rental flows. Updated only the sandbox test adapter's read allowlist to reflect the existing renewal lookup in the unchanged webhook.
- `npm run test:square-ui`: original and live sequence UI; live test verifies confirmation-route handoff and purchase emission after verified server confirmation, never on an uncertain rental outcome.
- Focused ESLint on new UI/measurement code and production build.
- Full repository `tsc --noEmit -p tsconfig.app.json` already fails on generated-schema duplicates, stale table types and unrelated existing components; no new-file diagnostic was observed. Do not report it as passing.

Production confirmation/retired-endpoint negative checks do not establish successful Google receipt. Record deployment URLs/SHAs and actual Google-side verification separately in the delivery report. Keep the Ads campaign unpublished until that last verification is complete.
