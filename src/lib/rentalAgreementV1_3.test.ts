import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  FLORIDA_PRIMARY_INSURANCE_HEADING,
  FLORIDA_PRIMARY_INSURANCE_STATUTORY_TEXT,
  RENTAL_AGREEMENT_EFFECTIVE_AT,
  RENTAL_AGREEMENT_MASTER_ID,
  RENTAL_AGREEMENT_V1_3,
  RENTAL_AGREEMENT_VERSION,
  renderRentalAgreementV1_3,
} from "./rentalAgreementV1_3";

const values = {
  agreementId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  guestProfileId: "44444444-4444-4444-8444-444444444444",
  guestLegalName: "Test Guest",
  bookingId: "ZYX-2026-000001 / 33333333-3333-4333-8333-333333333333",
  vehicle: "2026 / Test Make / Test Model / TEST-001",
  vehicleVin: "TESTVIN1234567890",
  host: "Test Host",
  pickup: "2026-10-01 / 10:00 / Miami Beach",
  scheduledReturn: "2026-10-02 / 10:00 / Brickell",
  rentalCharges: "Rental subtotal: $100.00\nService / marketplace fees: $12.00\nTaxes: $8.00\nAdd-ons: None\nPromo / discount: None\nFinal agreed rental total: $120.00 USD",
  securityDepositAuthorizationHold: "$500.00 USD",
  mileage: "Per-day, non-cumulative; 75 included mile(s) per day",
  additionalMileage: "$1.40 per additional mile",
  authorizedDrivers: ["Test Guest"],
  additionalBookingSpecificTerms: "None",
};

const rendered = renderRentalAgreementV1_3(values);

assert.equal(rendered, renderRentalAgreementV1_3(values));
assert.equal(rendered.match(/\[[^\]\n]+\]/g), null);
assert.match(rendered, /Reservation \/ Booking ID: ZYX-2026-000001/);
assert.match(rendered, /Vehicle: 2026 \/ Test Make \/ Test Model \/ TEST-001/);
assert.match(rendered, /Vehicle VIN: TESTVIN1234567890/);
assert.match(rendered, /Authorized Driver\(s\): Test Guest/);
assert.match(rendered, new RegExp(`Agreement Version ID: ${RENTAL_AGREEMENT_MASTER_ID}`));
assert.match(rendered, new RegExp(`Agreement Effective At: ${RENTAL_AGREEMENT_EFFECTIVE_AT}`));
assert.equal(RENTAL_AGREEMENT_VERSION, "1.3");
assert.equal(createHash("sha256").update(RENTAL_AGREEMENT_V1_3).digest("hex"), "e101303602ac643e02bab46633a6f0600e9a4d0b3962d57b3040ef2b162e3530");
assert.equal(rendered.match(new RegExp(FLORIDA_PRIMARY_INSURANCE_STATUTORY_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length, 1);
assert.ok(rendered.indexOf(FLORIDA_PRIMARY_INSURANCE_HEADING) > rendered.indexOf("TRIP & FINANCIAL SUMMARY"));
assert.ok(rendered.indexOf(FLORIDA_PRIMARY_INSURANCE_HEADING) < rendered.indexOf("1. ELECTRONIC ACCEPTANCE"));
assert.ok(rendered.indexOf(FLORIDA_PRIMARY_INSURANCE_HEADING) < rendered.indexOf("15. INSURANCE; VEHICLE-SPECIFIC COVERAGE; NO GUARANTEE OF CLAIM ACCEPTANCE"));
assert.match(rendered, /This provision does not create insurance coverage\./);
assert.match(rendered, /ZONYX is not an insurer unless expressly stated otherwise/);
assert.equal([...rendered.matchAll(/^([1-9]|[12][0-9]|3[0-6])\. [A-Z]/gm)].length, 36);
assert.equal([...rendered.matchAll(/^A(?:[1-9]|1[01])\. [A-Z]/gm)].length, 11);

console.log("PASS: v1.3 renders deterministically with booking-specific values and no placeholders");