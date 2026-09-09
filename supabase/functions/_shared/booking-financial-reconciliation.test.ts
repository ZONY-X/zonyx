import assert from "node:assert/strict";
import { authorizeReconciliation, buildReconciliationProposal, parseReconciliationInput, proposalFingerprintPayload, summarizeEntries } from "./booking-financial-reconciliation.ts";

assert.equal(authorizeReconciliation(false,false).status,401);assert.equal(authorizeReconciliation(true,false).status,403);assert.equal(authorizeReconciliation(true,true).allowed,true);
const validId="b81b9d87-acfe-4e51-a4f3-b49c09e68ab1";
assert.deepEqual(Object.keys(parseReconciliationInput({action:"prepare",booking_id:validId,approved_ambiguous_payment_intent_ids:[]})||{}).sort(),["action","approved","bookingId","idempotencyKey","proposalFingerprint","reason"].sort());
assert.equal(parseReconciliationInput({action:"prepare",booking_id:validId,amount:9312}),null);
assert.equal(parseReconciliationInput({action:"prepare",booking_id:validId,stripe_snapshot:{}}),null);
console.log("PASS: unauthenticated, Guest/Host rejected; authoritative Admin accepted; client cannot submit amounts or Stripe evidence");

const before={grand_total_cents:29880,subtotal_cents:24900,service_fee_cents:2988,taxes_cents:1992,currency:"usd",created_at:"2026-08-01T00:00:00Z"};
const attempt=(confidence:string,id="pi_hold",captured=9312,released=65688,refunded=0)=>({payment_intent_id:id,original_authorization:75000,currency:"usd",created:1788000000,cancellation_timestamp:1788001000,current_status:"succeeded",association:{confidence,reasons:["same_customer"]},history:{historical_captured_amount:captured,historical_released_uncaptured_amount:released,historical_refunded_amount:refunded}});
const base={observed_at:"2026-09-09T00:00:00Z",checkout:{id:"cs_1",amount_total:40000,currency:"usd",created:1787900000},rental_payment:{payment_intent_id:"pi_rental",status:"succeeded",amount_received:40000,currency:"usd",created:1787900000,latest_charge:{id:"ch_1"},refunds:[]},security_deposit_attempts:{timeline:[attempt("AMBIGUOUS")]}};

const excluded=buildReconciliationProposal(base,before,[]);const excludedSummary=summarizeEntries(excluded.entries);
assert.equal(excludedSummary.original_trip_amount_cents,29880);assert.equal(excludedSummary.final_trip_total_cents,40000);assert.equal(excludedSummary.amount_paid_cents,40000);assert.equal(excludedSummary.balance_cents,0);assert.equal(excludedSummary.deposit_captured_cents,0);assert.deepEqual(excluded.excluded_ambiguous,["pi_hold"]);
console.log("PASS: $298.80 local history plus audited adjustment reconciles to Stripe-proven $400 without erasing original");
console.log("PASS: ambiguous deposit is excluded automatically");

const approved=buildReconciliationProposal(base,before,["pi_hold"]);const summary=summarizeEntries(approved.entries);
assert.equal(summary.deposit_authorized_cents,75000);assert.equal(summary.deposit_captured_cents,9312);assert.equal(summary.deposit_released_cents,65688);assert.equal(summary.net_deposit_retained_cents,9312);
assert.equal(approved.entries.find(e=>e.stable_key==="deposit-capture:pi_hold")?.metadata.admin_approved_ambiguous,true);
console.log("PASS: explicit ambiguous approval records $750 authorized, $93.12 captured, $656.88 released once with audit metadata");

const multiple={...base,security_deposit_attempts:{timeline:[attempt("CONFIRMED","pi_1",0,75000),attempt("CONFIRMED","pi_2",0,75000),attempt("CONFIRMED","pi_3",9312,65688)]}};
const multi=summarizeEntries(buildReconciliationProposal(multiple,before,[]).entries);
assert.equal(multi.deposit_authorized_cents,75000);assert.equal(multi.deposit_captured_cents,9312);assert.notEqual(multi.deposit_authorized_cents,225000);
console.log("PASS: multiple authorizations are not summed as revenue or booking-level authorization exposure");

const refunded={...base,security_deposit_attempts:{timeline:[attempt("CONFIRMED","pi_ref",9312,65688,9312)]}};
assert.equal(summarizeEntries(buildReconciliationProposal(refunded,before,[]).entries).net_deposit_retained_cents,0);
console.log("PASS: $93.12 deposit capture then $93.12 refund yields zero net retained");

const keys=approved.entries.map(e=>e.stable_key);assert.equal(new Set(keys).size,keys.length);
assert.deepEqual(buildReconciliationProposal(base,before,["pi_hold"]).entries,approved.entries);
assert.equal(proposalFingerprintPayload(approved.entries,["pi_hold"]),proposalFingerprintPayload([...approved.entries].reverse(),["pi_hold"]));
assert.notEqual(proposalFingerprintPayload(approved.entries,["pi_hold"]),proposalFingerprintPayload(excluded.entries,[]));
console.log("PASS: stable ledger keys make repeated proposal deterministic and persistence idempotent");
console.log("PASS: proposal fingerprint is order-stable and changes when approved evidence changes");