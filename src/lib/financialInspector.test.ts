import { strict as assert } from "node:assert";
import { buildFinancialInspectorRequest, formatInspectorMoney } from "./financialInspector";

const request = buildFinancialInspectorRequest("b81b9d87-acfe-4e51-a4f3-b49c09e68ab1");
assert.deepEqual(Object.keys(request), ["booking_id"]);
assert.equal(request.booking_id, "b81b9d87-acfe-4e51-a4f3-b49c09e68ab1");
assert.equal("payment_intent_id" in request, false);
assert.equal("amount" in request, false);
assert.equal(formatInspectorMoney(9312), "$93.12");
assert.equal(formatInspectorMoney(null), "Unknown");

console.log("PASS: inspector UI sends only booking_id and cannot submit Stripe IDs or amounts");
console.log("PASS: inspector UI formats integer cents without floating-point input");