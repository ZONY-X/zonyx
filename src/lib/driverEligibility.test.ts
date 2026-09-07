import { strict as assert } from "node:assert";
import { buildDriverEligibilityPath, getSafeEligibilityReturnPath } from "./driverEligibility";

const bookingUrl = "/booking/vehicle-id?start=2037-06-10&end=2037-06-12&pickupTime=11%3A30&dropoffTime=16%3A45&pickupLocation=Miami+Beach&dropoffLocation=Brickell&promo=SAVE";
const eligibilityPath = buildDriverEligibilityPath(bookingUrl, "2037-06-12");
const params = new URLSearchParams(eligibilityPath.split("?")[1]);

assert.equal(params.get("returnTo"), bookingUrl);
assert.equal(params.get("tripEnd"), "2037-06-12");
assert.equal(getSafeEligibilityReturnPath(params.get("returnTo")), bookingUrl);
assert.equal(getSafeEligibilityReturnPath("https://malicious.example"), "/fleet");
assert.equal(getSafeEligibilityReturnPath("//malicious.example"), "/fleet");

console.log("PASS: booking URL, location, dates, times, and promo survive eligibility completion");
console.log("PASS: unsafe eligibility return URLs are rejected");