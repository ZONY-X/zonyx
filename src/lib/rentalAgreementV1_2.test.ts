import { strict as assert } from "node:assert";
import { renderRentalAgreementV1_2 } from "./rentalAgreementV1_2";

const values = {
  agreementId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  guestLegalName: "Test Guest",
  bookingId: "ZYX-2026-000001 / 33333333-3333-4333-8333-333333333333",
  vehicle: "2026 / Test Make / Test Model / TEST-001",
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

const rendered = renderRentalAgreementV1_2(values);

assert.equal(rendered, renderRentalAgreementV1_2(values));
assert.equal(rendered.match(/\[[^\]\n]+\]/g), null);
assert.match(rendered, /Reservation \/ Booking ID: ZYX-2026-000001/);
assert.match(rendered, /Vehicle: 2026 \/ Test Make \/ Test Model \/ TEST-001/);
assert.match(rendered, /Authorized Driver\(s\): Test Guest/);
assert.equal([...rendered.matchAll(/^([1-9]|[12][0-9]|3[0-6])\. [A-Z]/gm)].length, 36);
assert.equal([...rendered.matchAll(/^A(?:[1-9]|1[01])\. [A-Z]/gm)].length, 11);

console.log("PASS: v1.2 renders deterministically with booking-specific values and no placeholders");