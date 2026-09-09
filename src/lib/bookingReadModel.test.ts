import assert from "node:assert/strict";
import { displayedTripTotal, fulfillmentLabel } from "./bookingReadModel.ts";
assert.equal(displayedTripTotal({displayed_total_cents:40000}),40000);
assert.equal(displayedTripTotal({displayed_total_cents:29880}),29880);
assert.equal(fulfillmentLabel("airport_delivery"),"Airport Delivery");
assert.equal(fulfillmentLabel("delivery"),"Delivery");
assert.equal(fulfillmentLabel("pickup"),"Pickup");
console.log("PASS: canonical read-model total and fulfillment labels");