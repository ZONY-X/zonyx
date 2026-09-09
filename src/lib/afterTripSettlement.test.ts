import assert from 'node:assert/strict';
import{settlementStatus,totalHistoricalCharges}from'./afterTripSettlement.ts';
assert.equal(totalHistoricalCharges([{category:'charging_energy',amount_cents:5500,explanation:'Battery'},{category:'parking_tickets_violations',amount_cents:1800,explanation:'Parking'},{category:'tolls',amount_cents:517,explanation:'Tolls'},{category:'administrative_fee',amount_cents:1495,explanation:'Admin'}]),9312);
assert.equal(settlementStatus(9312,9312),'paid');assert.equal(settlementStatus(90000,75000),'partially_paid');assert.equal(settlementStatus(5000,0),'unpaid');
console.log('PASS: $93.12 structured charges and unpaid/partial/paid settlement states');