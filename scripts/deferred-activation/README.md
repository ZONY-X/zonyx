# Deferred coordinated provider activation

Preparation keeps stripe-checkout identical to deployed production version 20.
Do not deploy stripe-checkout for this preparation release.

stripe-provider-lock.patch preserves the reviewed provider reservation change.
It is not an executable deployment entrypoint. Rebase/review it against the
then-current production Stripe source and test it before a coordinated release.

Both PayPal handlers require PAYPAL_PROVIDER_LOCK_READY=true before processing
POST requests. Unset/false rejects requests with 503 before auth, database access,
OAuth or provider calls. This gate applies to sandbox and LIVE. It is an operator
attestation, not automatic discovery of the Stripe deployment.

Never set this gate until the Stripe reservation patch is deployed and verified
in the same environment. Deploying the preparation handlers must not set it.
Existing rental, LIVE, card and internal-access gates remain independently required.

Later activation must review in-flight legacy Stripe sessions, provider switching,
concurrent checkout/capture, cancellation and recovery. The preserved patch alone
is not proof that all legacy sessions or every race are safe. Coordinate that
release separately; do not enable PayPal alongside the unchanged Stripe handler.
