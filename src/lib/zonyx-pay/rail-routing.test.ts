import assert from "node:assert/strict";
import { PAYMENT_PLATFORM, selectAcquiringRail } from "./rail-routing.ts";
assert.equal(PAYMENT_PLATFORM, "zonyx-pay");
const rails = [{provider:"paypal",enabled:true,eligible:true},{provider:"square",enabled:true,eligible:true}];
assert.equal(selectAcquiringRail(rails),"square");
assert.equal(selectAcquiringRail(rails,"paypal"),"paypal");
assert.equal(selectAcquiringRail([{provider:"square",enabled:false,eligible:true},rails[0]]),"paypal");
assert.throws(()=>selectAcquiringRail(rails,"stripe"),/reconcile/);
assert.throws(()=>selectAcquiringRail([]),/No acquiring rail/);
