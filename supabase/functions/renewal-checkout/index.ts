import {squareRenewalCheckout} from '../_shared/payment-adapters/square-renewal-checkout.ts';
// Public Square links are durable provider affinity, verified inside the adapter.
// New period links use payment_runtime_config via ensureRenewalPaymentLink.
Deno.serve(squareRenewalCheckout);
