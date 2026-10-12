import assert from "node:assert/strict";
import { planZonyxCheckout } from "./checkout-plan.ts";
const rails = [{provider:"paypal",enabled:true,eligible:true},{provider:"square",enabled:true,eligible:true}];
assert.deepEqual(planZonyxCheckout({bookingId:"booking-1",rails}),{platform:"zonyx-pay",acquiringRail:"square",bookingId:"booking-1"});
assert.equal(planZonyxCheckout({bookingId:"booking-1",rails,existingProvider:"paypal"}).acquiringRail,"paypal");
assert.throws(()=>planZonyxCheckout({bookingId:"",rails}),/booking/);
assert.throws(()=>planZonyxCheckout({bookingId:"booking-1",rails:[]}),/No acquiring rail/);
