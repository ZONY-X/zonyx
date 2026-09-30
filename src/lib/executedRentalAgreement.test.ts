import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executedAgreementBytes, executedAgreementFilename, type ExecutedRentalAgreement } from "./executedRentalAgreement.ts";

const rendered="Historical executed agreement\nVersion 1.2\nExact accepted terms.";
const agreement={reservation_number:"ZNX-000142",booking_id:"booking",master_version:"1.2",rendered_text:rendered} as ExecutedRentalAgreement;
const bytes=executedAgreementBytes(agreement);
assert.equal(new TextDecoder().decode(bytes),rendered);
assert.equal(createHash("sha256").update(bytes).digest("hex"),createHash("sha256").update(rendered).digest("hex"));
assert.equal(executedAgreementFilename(agreement),"ZNX-000142-executed-rental-agreement-v1.2.txt");
console.log("PASS: executed agreement download is the exact stored rendered snapshot bytes");