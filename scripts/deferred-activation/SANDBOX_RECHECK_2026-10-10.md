# PayPal readiness recheck — 2026-10-10

Production activation is NOT ready. This is an execution record, not a completion certificate.

Starting remote PR #1 head: `02415766b86c26ac3f956595fdf8a573b4e1cb95`. GitHub Actions PayPal checkout regression run `37996046651` completed successfully; Vercel status is successful. The PR remains open and unmerged. Existing sandbox migrations include shared vehicle payment claims and lock-order hardening.

The application deliberately records a rental capture without confirming the trip: `finalize_paypal_rental_payment` creates a disabled/capability-pending deposit, and `protect_provider_payment_booking` rejects operational trip transitions without a verified deposit lifecycle. A paid receipt is not a confirmed customer rental. No direct DB update or simulated deposit was used to bypass this requirement.

Fixed paid-payment recovery: the handler previously fabricated `depositStatus=disabled`. It now reads the persisted provider receipt, rejects missing/conflicting evidence, and preserves capability-verification status without constructing a provider client or sending another capture. Two additional mocked handler cases cover these failures. This change was deployed exclusively to sandbox `pvowzjqimikcoyjwclez`, JWT verification enabled, checkout version 15, bundle SHA256 `933fdace22f3b120ca126ca9642a466aae0b0b70637aaea5b8c8d4904a686fa3`.

Actual authenticated recovery returned paid USD 108 cents, captured USD 108 cents, deposit disabled, and `bookingConfirmed=false`. Independent PayPal canonical GET confirmed order `92X93119HK9976247`, intent CAPTURE, status COMPLETED, exactly one completed capture `4H235147CP5152204`, matching payment reference/custom ID `30b2740d-6611-48a9-8496-c557b97ea86c`, successful 3DS, and matching DB state. No new provider order/capture was dispatched. Original booking-to-capture, challenge/failure, and authentic postback receipts remain documented in `SANDBOX_E2E_2026-10-09.md`.

The authenticated existing PayPal Sandbox application has Expanded checkout and Advanced Card Payments enabled. Save payment methods is currently disabled. A reusable payment-token/deposit-renewal path requires that capability; expanding permission to retain payment methods requires action-time confirmation under browser policy. No sandbox capability permission was changed and no LIVE account operation was performed. The current implementation also lacks the verified PayPal deposit lifecycle and production customer-access activation; these are outstanding implementation/verification work, not evidence that the rental is ready.

The Stripe TEST key digest/update timestamp remains unchanged from October 8. Prior actual provider read returned `api_key_expired`. The independently authenticated Stripe connector does not repair the app credential. Its completed TEST payment still remains awaiting reconciliation in the DB.

Latest local payment regression: 18 policy/client, 22 migration, 15 PayPal handler, 7 Stripe handler, 8 Stripe webhook, 6 HMAC, 5 diagnostics, 10 RSA checks passed. All 24 unit-test files passed. These mocked/local checks do not establish completed booking confirmation. Targeted lint and whitespace checks passed.

Current sandbox DB/function/provider requests succeeded despite the quota banner; no paid infrastructure was provisioned. No production merge/deployment/configuration change or real financial transaction was performed.
