import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261102190000_paypal_vault_mit_and_deposit_capture.sql",
  "utf8",
);
const vault = readFileSync("supabase/functions/paypal-vault/index.ts", "utf8");
const mit = readFileSync("supabase/functions/paypal-mit/index.ts", "utf8");
const webhook = readFileSync("supabase/functions/paypal-webhook/index.ts", "utf8");
const client = readFileSync("supabase/functions/_shared/paypal-client.ts", "utf8");

assert.match(migration, /paypal_payment_sources/);
assert.match(migration, /paypal_payment_consents/);
assert.match(migration, /paypal_vault_requests/);
assert.match(migration, /paypal_mit_operations/);
assert.match(migration, /paypal_deposit_captures/);
assert.match(migration, /claim_paypal_mit_operation/);
assert.match(migration, /remaining authorization/);
assert.match(vault, /exchangeVaultSetupToken/);
assert.match(vault, /create-setup-token/);
assert.match(vault, /already in progress/);
assert.match(vault, /revoked_at/);
assert.match(vault, /consentTextHash|consentHash/);
assert.match(mit, /PAYPAL_MIT_LIVE_ENABLED/);
assert.match(mit, /finalize_paypal_deposit_capture/);
assert.match(mit, /payment_initiator: "MERCHANT"/);
assert.match(mit, /captureAuthorization/);
assert.match(webhook, /finalize_paypal_mit_operation/);
assert.match(webhook, /finalize_paypal_deposit_capture/);
assert.match(client, /\/v3\/vault\/setup-tokens/);
assert.match(client, /\/v3\/vault\/payment-tokens/);
assert.match(client, /\/v2\/payments\/authorizations\/.*\/capture/);
assert.match(readFileSync("src/lib/paypal-sdk.ts", "utf8"), /createCardFieldsSavePaymentSession/);
assert.match(readFileSync("src/components/rental/PayPalCardVaultForm.tsx", "utf8"), /vaultSetupToken/);
assert.match(readFileSync("src/components/admin/PayPalDepositCapturePanel.tsx", "utf8"), /capture-deposit/);
console.log("PASS: PayPal vault, MIT, partial-capture, and webhook contracts");
