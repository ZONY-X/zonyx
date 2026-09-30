import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  FLORIDA_PRIMARY_INSURANCE_HEADING,
  FLORIDA_PRIMARY_INSURANCE_STATUTORY_TEXT,
  RENTAL_AGREEMENT_EFFECTIVE_AT,
  RENTAL_AGREEMENT_MASTER_ID,
  RENTAL_AGREEMENT_V1_4,
  RENTAL_AGREEMENT_VERSION,
  renderRentalAgreementV1_4,
} from "./rentalAgreementV1_4";
import { RENTAL_AGREEMENT_V1_3 } from "./rentalAgreementV1_3";

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
  primaryAuthorizedDriver: "Test Guest",
  additionalAuthorizedDrivers: ["Additional Driver"],
  reservationSpecificProtection: "CarInsuRent Rental Vehicle Excess Protection",
  additionalBookingSpecificTerms: "None",
};

const rendered = renderRentalAgreementV1_4(values);

assert.equal(rendered, renderRentalAgreementV1_4(values));
assert.equal(rendered.match(/\[[^\]\n]+\]/g), null);
assert.match(rendered, /Reservation \/ Booking ID: ZYX-2026-000001/);
assert.match(rendered, /Vehicle: 2026 \/ Test Make \/ Test Model \/ TEST-001/);
assert.match(rendered, /Vehicle VIN: TESTVIN1234567890/);
assert.match(rendered, /Primary Authorized Driver: Test Guest/);
assert.match(rendered, /Additional Authorized Driver\(s\): Additional Driver/);
assert.match(rendered, /Damage Liability \/ Rental Vehicle Excess: US\$500 per covered incident/);
assert.match(rendered, /Reservation-Specific Protection: CarInsuRent Rental Vehicle Excess Protection/);
assert.match(rendered, new RegExp(`Agreement Version ID: ${RENTAL_AGREEMENT_MASTER_ID}`));
assert.match(rendered, new RegExp(`Agreement Effective At: ${RENTAL_AGREEMENT_EFFECTIVE_AT}`));
assert.equal(RENTAL_AGREEMENT_VERSION, "1.4");
const canonicalHash = createHash("sha256").update(RENTAL_AGREEMENT_V1_4).digest("hex");
assert.equal(canonicalHash, "2d941427e7d1c27cd744d3785a2bca40f2200e327e0963e5d5558ab95fec9be3");
assert.equal(rendered.match(new RegExp(FLORIDA_PRIMARY_INSURANCE_STATUTORY_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length, 1);
assert.ok(rendered.indexOf(FLORIDA_PRIMARY_INSURANCE_HEADING) > rendered.indexOf("TRIP & FINANCIAL SUMMARY"));
assert.ok(rendered.indexOf(FLORIDA_PRIMARY_INSURANCE_HEADING) < rendered.indexOf("1. ELECTRONIC ACCEPTANCE"));
assert.ok(rendered.indexOf(FLORIDA_PRIMARY_INSURANCE_HEADING) < rendered.indexOf("15. INSURANCE; RENTAL VEHICLE EXCESS PROTECTION; VEHICLE-SPECIFIC AND RESERVATION-SPECIFIC COVERAGE; NO GUARANTEE OF CLAIM ACCEPTANCE"));
assert.match(rendered, /This provision does not create insurance coverage\./);
assert.match(rendered, /Unless expressly identified otherwise in applicable booking documentation, ZONYX is not the insurer and does not underwrite, adjudicate, approve, or independently determine insurance coverage\./);
assert.match(rendered, /DAMAGE LIABILITY \/ RENTAL VEHICLE EXCESS/);
assert.match(rendered, /For purposes of any applicable rental-vehicle excess or deductible-reimbursement protection/);
assert.match(rendered, /RENTAL VEHICLE EXCESS PROTECTION/);
assert.match(rendered, /GUEST INSURANCE INFORMATION AND COOPERATION/);
assert.match(rendered, /NO TRANSFER OF UNINSURED OBLIGATIONS TO ZONYX/);
const section15 = RENTAL_AGREEMENT_V1_4.match(/15\. INSURANCE;[\s\S]*?(?=\n⸻\n\n16\.)/)?.[0];
assert.ok(section15);
assert.equal(createHash("sha256").update(section15).digest("hex"), "0e43e63a29d14a6a7e20ba5a11ec5f94cc300215c02c4fbcab0bf7e40e65cda0");
const numberedSection = (text: string, number: number) => text.match(new RegExp(`^${number}\\. [\\s\\S]*?(?=\\n⸻\\n\\n${number + 1}\\.|$)`, "m"))?.[0];
for (let number = 1; number <= 35; number += 1) {
  if ([4, 13, 15].includes(number)) continue;
  assert.equal(numberedSection(RENTAL_AGREEMENT_V1_4, number), numberedSection(RENTAL_AGREEMENT_V1_3, number), `Section ${number} changed unexpectedly`);
}
assert.equal(RENTAL_AGREEMENT_V1_4.slice(RENTAL_AGREEMENT_V1_4.indexOf("36. SURVIVAL")), RENTAL_AGREEMENT_V1_3.slice(RENTAL_AGREEMENT_V1_3.indexOf("36. SURVIVAL")));
const renderedWithoutTrustedRecords = renderRentalAgreementV1_4({ ...values, additionalAuthorizedDrivers: [], reservationSpecificProtection: "None" });
assert.match(renderedWithoutTrustedRecords, /Additional Authorized Driver\(s\): None/);
const renderedWithMultipleDrivers = renderRentalAgreementV1_4({ ...values, additionalAuthorizedDrivers: ["Alejandra Ponce Gutierrez", "Second Additional Driver"] });
assert.match(renderedWithMultipleDrivers, /Additional Authorized Driver\(s\): Alejandra Ponce Gutierrez, Second Additional Driver/);
assert.match(renderedWithoutTrustedRecords, /Reservation-Specific Protection: None/);
assert.equal([...rendered.matchAll(/^([1-9]|[12][0-9]|3[0-6])\. [A-Z]/gm)].length, 36);
assert.equal([...rendered.matchAll(/^A(?:[1-9]|1[01])\. [A-Z]/gm)].length, 11);

console.log("PASS: v1.4 renders deterministically with booking-specific values and no placeholders");