import { strict as assert } from "node:assert";
import { getAllowedAccountModes, resolveAccountMode, routeForAccountMode, type AccountCapabilities } from "@/lib/accountMode";

const capabilities = (overrides: Partial<AccountCapabilities> = {}): AccountCapabilities => ({
  profile_id: "profile-id",
  full_name: "Test User",
  email: "test@example.com",
  can_guest: true,
  can_host: false,
  can_admin: false,
  ...overrides,
});

assert.deepEqual(getAllowedAccountModes(capabilities()), ["guest"]);
assert.deepEqual(getAllowedAccountModes(capabilities({ can_host: true })), ["guest", "host"]);
assert.deepEqual(getAllowedAccountModes(capabilities({ can_host: true, can_admin: true })), ["guest", "host", "admin"]);
assert.equal(getAllowedAccountModes(capabilities()).includes("admin"), false);
assert.equal(getAllowedAccountModes(capabilities()).includes("host"), false);
assert.equal(resolveAccountMode("admin", capabilities()), "guest");
assert.equal(resolveAccountMode("host", capabilities()), "guest");
assert.equal(resolveAccountMode("host", capabilities({ can_host: true })), "host");
assert.equal(routeForAccountMode("guest"), "/guest-dashboard");
assert.equal(routeForAccountMode("host"), "/host-dashboard");
assert.equal(routeForAccountMode("admin"), "/admin-dashboard");

console.log("PASS: guest-only capability cannot activate Host or Admin mode");
console.log("PASS: host capability adds Host without Admin mode");
console.log("PASS: authoritative admin capability adds the separate Admin workspace");