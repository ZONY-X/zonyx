// Server-only authorization: frontend visibility never grants discounted pricing.
export function bookingTestMode(env: (key: string) => string | undefined, code: string | undefined, email: string | null, authorizedRole: boolean): "normal" | "sandbox" | "live_reduced" | "invalid" {
  if (!code?.trim()) return "normal";
  if (!authorizedRole || !env("ZONYX_INTERNAL_TEST_EMAIL") || email !== env("ZONYX_INTERNAL_TEST_EMAIL") || !env("ZONYX_INTERNAL_TEST_CODE") || code.trim() !== env("ZONYX_INTERNAL_TEST_CODE")) return "invalid";
  if (env("SQUARE_ENVIRONMENT") === "live" && env("ZONYX_LIVE_REDUCED_TEST_ENABLED") === "true") return "live_reduced";
  if (env("ZONYX_INTERNAL_TEST_ENABLED") === "true") return "sandbox";
  return "invalid";
}
