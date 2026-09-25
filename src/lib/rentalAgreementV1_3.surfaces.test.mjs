import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const statutoryText = "“The valid and collectible liability insurance and personal injury protection insurance of any authorized rental or leasing driver is primary for the limits of liability and personal injury protection coverage required by ss. 324.021(7) and 627.736, Florida Statutes.”";
const renderer = readFileSync(new URL("../components/legal/RentalAgreementDocument.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const confirmation = readFileSync(new URL("../../supabase/functions/send-booking-confirmation/index.ts", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../supabase/functions/rental-agreement/index.ts", import.meta.url), "utf8");
const cutover = readFileSync(new URL("../../supabase/migrations/20260925041412_rental_agreement_v1_3_cutover.sql", import.meta.url), "utf8");
const v12 = readFileSync(new URL("./rentalAgreementV1_2.ts", import.meta.url), "utf8");

assert.match(renderer, /rental-agreement-primary-insurance/);
assert.match(renderer, /PRIMARY INSURANCE — FLORIDA RENTALS/);
assert.ok(renderer.includes(statutoryText));
assert.match(css, /\.rental-agreement-primary-insurance\s*\{[^}]*font-size:\s*10pt;/s);
assert.match(css, /@media print[\s\S]*\.rental-agreement-primary-insurance\s*\{\s*font-size:\s*10pt !important;/);
assert.doesNotMatch(css, /@media[^}]*max-width[^}]*rental-agreement-primary-insurance[^}]*font-size:\s*(?:[0-9.]+px|[0-9.]+rem)/s);
assert.match(confirmation, /font-size: 10pt/);
assert.match(confirmation, /FLORIDA_PRIMARY_INSURANCE_STATUTORY_TEXT/);
assert.match(edge, /master_version === RENTAL_AGREEMENT_VERSION/);
assert.match(edge, /vehicle_identifier,vin/);
assert.match(edge, /agreement_version_id/);
assert.match(edge, /agreement_effective_at/);
assert.match(edge, /vehicle_vin/);
assert.match(cutover, /accepted_at IS NULL/);
assert.match(cutover, /master_version = '1\.2'/);
assert.doesNotMatch(cutover, /UPDATE\s+public\.booking_rental_agreements/i);
const destructiveStatements = cutover.match(/DELETE FROM public\.booking_rental_agreements[\s\S]*?;/gi) ?? [];
assert.equal(destructiveStatements.length, 1);
assert.match(destructiveStatements[0], /accepted_at IS NULL/);
assert.doesNotMatch(destructiveStatements[0], /accepted_at\s+IS\s+NOT\s+NULL/i);
assert.equal((v12.match(/RENTAL_AGREEMENT_VERSION = "1\.2"/g) ?? []).length, 1);
assert.ok(!v12.includes("PRIMARY INSURANCE — FLORIDA RENTALS"));

console.log("PASS: v1.3 statutory rendering surfaces, metadata wiring, and immutable v1.2 cutover");