import assert from 'node:assert/strict';
import {RENTAL_AGREEMENT_V1_5} from './rentalAgreementV1_5.ts';
import {RENTAL_AGREEMENT_V1_6,RENEWAL_PAYMENT_POLICY_CLAUSE,EARLY_TERMINATION_CLAUSE} from './rentalAgreementV1_6.ts';
assert.equal(RENTAL_AGREEMENT_V1_6.replace(RENEWAL_PAYMENT_POLICY_CLAUSE+'\n\n⸻\n\n',''),RENTAL_AGREEMENT_V1_5);
assert.equal(RENTAL_AGREEMENT_V1_6.split(RENEWAL_PAYMENT_POLICY_CLAUSE).length,2);
assert.ok(RENTAL_AGREEMENT_V1_6.includes(EARLY_TERMINATION_CLAUSE));
for(const text of ['seven (7) calendar days','twenty-four (24) hours','USD $75.00','only within the scope'])assert.ok(RENEWAL_PAYMENT_POLICY_CLAUSE.includes(text));
console.log('Exact renewal clause, retained early termination clause and unchanged remaining contract verified.');
