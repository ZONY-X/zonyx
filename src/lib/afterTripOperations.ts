import { afterTripCategoryLabel, settlementStatus } from "@/lib/afterTripSettlement";

export type AfterTripOperationLine = {
  charge_id: string;
  booking_id: string;
  reservation_number: string;
  vehicle: string;
  guest_name: string | null;
  guest_email: string;
  host_name: string | null;
  host_email: string;
  trip_status: string;
  category: string;
  amount_cents: number;
  explanation: string;
  charge_status: string;
  settled_amount_cents: number;
  remaining_amount_cents: number;
  submitted_at: string;
};

export type AfterTripOperationTrip = {
  booking_id: string;
  reservation_number: string;
  vehicle: string;
  guest: string;
  host: string;
  trip_status: string;
  submitted_at: string;
  charges: (AfterTripOperationLine & { category_label: string })[];
  total_charge_cents: number;
  settled_cents: number;
  outstanding_cents: number;
  settlement_status: "paid" | "partially_paid" | "unpaid";
};

export function groupAfterTripOperations(lines: AfterTripOperationLine[]): AfterTripOperationTrip[] {
  const grouped = new Map<string, AfterTripOperationTrip>();
  for (const line of lines) {
    let trip = grouped.get(line.booking_id);
    if (!trip) {
      trip = {
        booking_id: line.booking_id,
        reservation_number: line.reservation_number,
        vehicle: line.vehicle,
        guest: line.guest_name || line.guest_email,
        host: line.host_name || line.host_email,
        trip_status: line.trip_status,
        submitted_at: line.submitted_at,
        charges: [],
        total_charge_cents: 0,
        settled_cents: 0,
        outstanding_cents: 0,
        settlement_status: "unpaid",
      };
      grouped.set(line.booking_id, trip);
    }
    trip.charges.push({ ...line, category_label: afterTripCategoryLabel(line.category) });
    trip.total_charge_cents += Number(line.amount_cents || 0);
    trip.settled_cents += Number(line.settled_amount_cents || 0);
    trip.outstanding_cents += Number(line.remaining_amount_cents || 0);
    if (line.submitted_at > trip.submitted_at) trip.submitted_at = line.submitted_at;
  }
  return [...grouped.values()].map((trip) => ({
    ...trip,
    charges: trip.charges.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)),
    settlement_status: settlementStatus(trip.total_charge_cents, trip.settled_cents) as "paid" | "partially_paid" | "unpaid",
  })).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
}

export function summarizeAfterTripOperations(trips: AfterTripOperationTrip[]) {
  return {
    trip_count: trips.length,
    total_charge_cents: trips.reduce((sum, trip) => sum + trip.total_charge_cents, 0),
    outstanding_cents: trips.reduce((sum, trip) => sum + trip.outstanding_cents, 0),
  };
}