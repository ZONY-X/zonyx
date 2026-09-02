import { getReservationEndTimestamp, isPastReservation } from "./reservationTime.ts";

const assertEqual = (actual: unknown, expected: unknown, description: string) => {
  if (actual !== expected) {
    throw new Error(`${description}: expected ${expected}, received ${actual}`);
  }
  console.log(`PASS: ${description}`);
};

const augustEnd = getReservationEndTimestamp("2026-08-22", "18:00");
assertEqual(new Date(augustEnd).toISOString(), "2026-08-22T22:00:00.000Z", "EDT reservation end converts to the correct UTC instant");
assertEqual(isPastReservation("2026-08-22", "18:00", Date.parse("2026-08-22T21:59:59Z")), false, "Reservation is active one second before its EDT dropoff");
assertEqual(isPastReservation("2026-08-22", "18:00", Date.parse("2026-08-22T22:00:01Z")), true, "Reservation is past one second after its EDT dropoff");

const winterEnd = getReservationEndTimestamp("2026-01-22", "18:00");
assertEqual(new Date(winterEnd).toISOString(), "2026-01-22T23:00:00.000Z", "EST reservation end converts with the UTC-5 offset");
assertEqual(isPastReservation("2026-09-05", "18:00", Date.parse("2026-09-01T12:00:00Z")), false, "Future reservation remains active");