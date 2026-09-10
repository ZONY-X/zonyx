import { strict as assert } from "node:assert";
import { getAllowedAccountModes, resolveAccountMode, routeForAccountMode, type AccountCapabilities } from "@/lib/accountMode";

const capabilities = (overrides: Partial<AccountCapabilities> = {}): AccountCapabilities => ({
  profile_id: "profile-id",
  full_name: "Test User",
  email: "test@example.com",
  can_guest: true,
  can_host: false,
  can_admin: false,
  can_operations: false,
  ...overrides,
});

assert.deepEqual(getAllowedAccountModes(capabilities()), ["guest"]);
assert.deepEqual(getAllowedAccountModes(capabilities({ can_host: true })), ["guest", "host"]);
assert.deepEqual(getAllowedAccountModes(capabilities({ can_host: true, can_admin: true })), ["guest", "host", "admin"]);
assert.deepEqual(getAllowedAccountModes(capabilities({ can_operations: true })), ["guest", "operations"]);
assert.deepEqual(getAllowedAccountModes(capabilities({ can_host: true, can_operations: true, can_admin: true })), ["guest", "host", "operations", "admin"]);
assert.equal(getAllowedAccountModes(capabilities()).includes("admin"), false);
assert.equal(getAllowedAccountModes(capabilities()).includes("host"), false);
assert.equal(resolveAccountMode("admin", capabilities()), "guest");
assert.equal(resolveAccountMode("host", capabilities()), "guest");
assert.equal(resolveAccountMode("host", capabilities({ can_host: true })), "host");
assert.equal(resolveAccountMode("operations", capabilities()), "guest");
assert.equal(resolveAccountMode("operations", capabilities({ can_operations: true })), "operations");
assert.equal(routeForAccountMode("guest"), "/guest-dashboard");
assert.equal(routeForAccountMode("host"), "/host-dashboard");
assert.equal(routeForAccountMode("admin"), "/admin-dashboard");
assert.equal(routeForAccountMode("operations"), "/operations-dashboard");

console.log("PASS: guest-only capability cannot activate Host or Admin mode");
console.log("PASS: host capability adds Host without Admin mode");
console.log("PASS: authoritative admin capability adds the separate Admin workspace");
console.log("PASS: Operations mode requires authoritative operations.workspace.access capability");