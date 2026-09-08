export function buildFinancialInspectorRequest(bookingId: string) {
  return { booking_id: bookingId } as const;
}

export function formatInspectorMoney(cents: number | null | undefined, currency = "usd") {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "Unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function formatStripeTimestamp(seconds: number | null | undefined) {
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : "Unknown";
}