# Square sandbox checkout

Square is primary for new card checkout; PayPal remains the alternative before provider reservation. Stripe cannot start new customer checkout. The stored provider cannot change after any financial attempt.

The checkout authorizes a separate security deposit with `autocomplete=false` and `delay_action=CANCEL`, then charges the rental using a second card token. Canonical Square GET evidence and the database lifecycle confirm the booking only when rental payment, driver/vehicle eligibility and hold coverage through return plus 24 hours all pass. Lost responses recover through canonical payment listing/GET and signed webhooks, without another charge. Pre-trip cancellation verifies hold void and rental refund before releasing inventory. Deposits cannot be captured.

All runtime/frontend gates default OFF. The API client supports only the Square sandbox hostname and the designated sandbox project; no live activation path exists. The branch disables automatic Vercel deployment. Do not apply migrations to ZONYX-PROD, merge or deploy without authorization.

`npm run test:square` executes offline handler contracts and an isolated PostgreSQL lifecycle. `npm run test:square-ui` exercises the card UI with intercepted services. These are simulations, not genuine Square transactions.

`npm run test:square-sandbox` opts into genuine Square sandbox REST calls with isolated local PostgreSQL and the committed handler bodies. It requires sandbox application, location, merchant and access-token environment variables. It never connects to a remote database. It accepts independent Web Payments SDK tokens via `SQUARE_TEST_HOLD_TOKEN` and `SQUARE_TEST_RENTAL_TOKEN`. Genuine signed webhook deliveries can be supplied as newline-delimited `{body, signature}` records via `SQUARE_SIGNED_WEBHOOK_CAPTURE_FILE`, with the original notification URL and signing key. The runner requires matching payment and refund deliveries; missing delivery exits unsuccessfully rather than claiming a complete pass. Private test evidence is ignored by Git.

Square online card authorizations have a seven-day limit. Checkout requires inspection coverage within 167 hours, including advance-booking time. Longer coverage and after-trip release/damage workflows are not supported by this sandbox checkout. Charged-and-refunded security deposits are not a substitute. Square commercial eligibility for ZONYX vehicle rentals and any account-specific approval requirements remain unverified; sandbox access does not establish approval.

References: [delayed capture](https://developer.squareup.com/docs/payments-api/take-payments/card-payments/delayed-capture), [sandbox testing](https://developer.squareup.com/docs/devtools/sandbox/payments), [refund policy](https://squareup.com/help/us/en/article/6116-process-refunds).
