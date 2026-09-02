import { fromZonedTime } from "date-fns-tz";

const ZONYX_TIME_ZONE = "America/New_York";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const getReservationEndTimestamp = (endDate: string, dropoffTime?: string | null) => {
  const date = endDate?.trim();
  const time = (dropoffTime ?? "23:59").trim();

  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) {
    return Number.NaN;
  }

  return fromZonedTime(`${date}T${time}:00`, ZONYX_TIME_ZONE).getTime();
};

export const isPastReservation = (
  endDate: string,
  dropoffTime?: string | null,
  nowTimestamp = Date.now(),
) => {
  const endTimestamp = getReservationEndTimestamp(endDate, dropoffTime);
  return Number.isFinite(endTimestamp) && endTimestamp < nowTimestamp;
};