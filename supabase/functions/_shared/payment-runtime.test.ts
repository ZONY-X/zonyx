import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { managePaymentRuntime, runtimePaymentProvider, processorStatuses } from "./payment-runtime.ts";
import { readyEnvironment } from "../../../scripts/payment-runtime-fixture.ts";
import { PaymentError } from "./payment-policy.ts";
import type { DB } from "./payment-service.ts";
let config = { active_provider: "square", version: 0 };
const audit: unknown[] = [];
const db = { from() { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { ...config }, error: null }) }; return q; }, async rpc(_name: string, args: Record<string, unknown>) { if (args._expected_version !== config.version) return { error: "stale" }; audit.push({actor:args._actor,old:config.active_provider,new:args._provider,reason:args._reason}); config = { active_provider: args._provider as string, version: config.version + 1 }; return { data: { ...config }, error: null }; } } as unknown as DB;
for (const provider of ["paypal", "square", "none"]) {
  const old = config.active_provider;
  await managePaymentRuntime(db, readyEnvironment, "admin", true, {action:"activate",provider,expectedVersion:config.version,reason:"Maintenance"});
  assert.equal(config.active_provider, provider);
  assert.deepEqual(audit.at(-1), {actor:"admin",old,new:provider,reason:"Maintenance"});
  for (const original of ["square", "paypal", "stripe"]) assert.equal(await runtimePaymentProvider(db, readyEnvironment, original), original);
}
await assert.rejects(runtimePaymentProvider(db, readyEnvironment), /no active processor/);
const before = JSON.stringify({config,audit});
await assert.rejects(managePaymentRuntime(db, readyEnvironment, "guest", false, {action:"activate",provider:"square",expectedVersion:config.version}), e => e instanceof PaymentError && e.status === 403);
for (const provider of ["authorize_net", "chase", "clover", "finix", "stripe", "__proto__", "unknown"]) await assert.rejects(managePaymentRuntime(db, readyEnvironment, "admin", true, {action:"activate",provider,expectedVersion:config.version}), /cannot be activated/);
for (const unavailableEnv of [(key: string) => key === "SQUARE_CHECKOUT_ENABLED" ? "false" : readyEnvironment(key), () => undefined]) await assert.rejects(managePaymentRuntime(db, unavailableEnv, "admin", true, {action:"activate",provider:"square",expectedVersion:config.version}), /cannot be activated/);
assert.equal(JSON.stringify({config,audit}), before);
assert.equal(processorStatuses(readyEnvironment).find(p=>p.id==="stripe")?.status,"Historical only");
config.active_provider = "square";
await assert.rejects(runtimePaymentProvider(db, key => key === "SQUARE_CHECKOUT_ENABLED" ? "false" : readyEnvironment(key)), /not ready/);
assert.equal(await runtimePaymentProvider(db, readyEnvironment), "square");
// Actual Edge handler: client flags never authorize, non-admin never opens service DB.
const source = readFileSync("supabase/functions/admin-payment-runtime/index.ts", "utf8").replace(/^import .*;\n/gm, "");
for (const admin of [false, true]) {
  let handler: (r: Request) => Promise<Response>; let writes = 0;
  new Function("serve", "createClient", "env", "corsHeaders", "json", "PaymentError", "managePaymentRuntime", "serviceClient", "paymentFailure", stripTypeScriptTypes(source))(
    (h: typeof handler) => {handler=h;}, () => ({auth:{getUser:async()=>({data:{user:{id:"admin"}}})},rpc:async()=>({data:admin,error:null})}), readyEnvironment, {}, (status: number, body: unknown)=>Response.json(body,{status}), PaymentError, managePaymentRuntime, ()=>{writes++;return db;}, (e: PaymentError)=>Response.json({error:e.message},{status:e.status||500})
  );
  const response = await handler!(new Request("https://fixture.invalid", {method:"POST",body:JSON.stringify({action:"read"})}));
  assert.equal(response.status, admin ? 200 : 403); assert.equal(writes, admin ? 1 : 0);
  const previous = JSON.stringify(config);
  const activate = await handler!(new Request("https://fixture.invalid", {method:"POST",body:JSON.stringify({action:"activate",provider:"paypal",expectedVersion:config.version,reason:"Handler test"})}));
  assert.equal(activate.status, admin ? 200 : 403);
  if (admin) assert.equal(config.active_provider,"paypal"); else assert.equal(JSON.stringify(config),previous);
}
console.log("PASS: runtime switch, 403/no writes, unavailable providers, none, original affinity, no fallback, audit and actual admin handler authorization.");
