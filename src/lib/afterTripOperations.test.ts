import assert from "node:assert/strict";
import { groupAfterTripOperations, summarizeAfterTripOperations, type AfterTripOperationLine } from "./afterTripOperations.ts";

const base = { vehicle: "Tesla Cybertruck AWD", guest_name: "Jhon", guest_email: "jhon@example.com", host_name: "Zoey", host_email: "host@example.com", trip_status: "completed", charge_status: "paid", submitted_at: "2026-08-28T00:00:00Z", explanation: "Documented charge" };
const lines: AfterTripOperationLine[] = [
  { ...base, charge_id: "1", booking_id: "booking-1", reservation_number: "ZNX-1", category: "charging_energy", amount_cents: 5500, settled_amount_cents: 5500, remaining_amount_cents: 0 },
  { ...base, charge_id: "2", booking_id: "booking-1", reservation_number: "ZNX-1", category: "tolls", amount_cents: 517, settled_amount_cents: 517, remaining_amount_cents: 0 },
  { ...base, charge_id: "3", booking_id: "booking-1", reservation_number: "ZNX-1", category: "parking_tickets_violations", amount_cents: 1800, settled_amount_cents: 1800, remaining_amount_cents: 0 },
  { ...base, charge_id: "4", booking_id: "booking-1", reservation_number: "ZNX-1", category: "administrative_fee", amount_cents: 1495, settled_amount_cents: 1495, remaining_amount_cents: 0 },
  { ...base, charge_id: "5", booking_id: "booking-2", reservation_number: "ZNX-2", category: "damage", amount_cents: 9000, settled_amount_cents: 4000, remaining_amount_cents: 5000 },
];
const trips = groupAfterTripOperations(lines);
assert.equal(trips.length, 2);
assert.equal(trips[0].booking_id, "booking-1");
assert.equal(trips[0].charges.length, 4);
assert.equal(trips[0].total_charge_cents, 9312);
assert.equal(trips[0].settled_cents, 9312);
assert.equal(trips[0].outstanding_cents, 0);
assert.equal(trips[0].settlement_status, "paid");
assert.deepEqual(trips[0].charges.map((line) => line.category_label), ["Battery / Charging", "Tolls", "Parking / Tickets / Violations", "Administrative Fee"]);
assert.equal(trips[1].settlement_status, "partially_paid");
assert.deepEqual(summarizeAfterTripOperations(trips), { trip_count: 2, total_charge_cents: 18312, outstanding_cents: 5000 });
console.log("PASS: charge lines group into one card per trip with aggregate settlement truth");