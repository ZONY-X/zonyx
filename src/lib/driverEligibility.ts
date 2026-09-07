export type DriverEligibilityStatus =
  | "incomplete"
  | "eligible_self_attested"
  | "age_ineligible"
  | "license_expired";

export function buildDriverEligibilityPath(returnTo: string, tripEnd: string) {
  const params = new URLSearchParams({ returnTo, tripEnd });
  return `/driver-eligibility?${params.toString()}`;
}

export function getSafeEligibilityReturnPath(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("://")
    ? value
    : "/fleet";
}