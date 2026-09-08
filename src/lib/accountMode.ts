export type AccountMode = "guest" | "host" | "admin";

export interface AccountCapabilities {
  profile_id: string;
  full_name: string;
  email: string;
  can_guest: boolean;
  can_host: boolean;
  can_admin: boolean;
}

export function routeForAccountMode(mode: AccountMode) {
  if (mode === "admin") return "/admin-dashboard";
  if (mode === "host") return "/host-dashboard";
  return "/guest-dashboard";
}

export function getAllowedAccountModes(capabilities: AccountCapabilities | null): AccountMode[] {
  if (!capabilities) return ["guest"];
  const modes: AccountMode[] = ["guest"];
  if (capabilities.can_host) modes.push("host");
  if (capabilities.can_admin) modes.push("admin");
  return modes;
}

export function resolveAccountMode(requested: string | null, capabilities: AccountCapabilities | null): AccountMode {
  const allowed = getAllowedAccountModes(capabilities);
  return requested && allowed.includes(requested as AccountMode) ? requested as AccountMode : "guest";
}