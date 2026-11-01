import { runtimePaymentProvider } from "./payment-runtime.ts";
import { readyEnvironment } from "../../../scripts/payment-runtime-fixture.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { PaymentError } from "./payment-policy.ts";
import { resolvePaymentProvider, paymentAdapters } from "./payment-adapters/registry.ts";

async function run(options: { active?: string; existing?: string; legacy?: boolean; authorized?: boolean; owned?: boolean; lookupError?: boolean } = {}) {
  let handler: (request: Request) => Promise<Response>;
  let reads = 0;
  const filters: Array<[string, string, unknown]> = [];
  const db = { from(table: string) { reads++; const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([table,key,value]); return q; }, single: async () => ({ data: table === "profiles" ? {id:"profile"} : options.owned === false ? null : {id:"booking",stripe_checkout_session_id:options.legacy?"historical-session":null}, error: null }), maybeSingle: async () => ({ data: table === "payment_runtime_config" ? {active_provider:options.active,version:0} : options.existing ? {provider:options.existing} : null, error: options.lookupError ? Error("offline") : null }) }; return q; } };
  const json = (status: number, data: unknown) => Response.json(data,{status});
  const source = readFileSync("supabase/functions/payment-routing/index.ts","utf8").replace(/^import .*;\n/gm,"");
  new Function("serve","createClient","corsHeaders","env","json","paymentFailure","serviceClient","PaymentError","resolvePaymentProvider","paymentAdapters","runtimePaymentProvider",stripTypeScriptTypes(source))(
    (h: typeof handler) => {handler=h;}, () => ({auth:{getUser:async()=>({data:{user:options.authorized===false?null:{id:"user"}},error:null})}}), {}, (key: string) => key === "ACTIVE_PAYMENT_PROVIDER" ? "ignored-secret" : readyEnvironment(key), json, (e: unknown) => json(e instanceof PaymentError?e.status:500,{error:e instanceof Error?e.message:"failed"}), () => db, PaymentError, resolvePaymentProvider, paymentAdapters, runtimePaymentProvider,
  );
  const invoke = () => handler!(new Request("https://fixture.invalid",{method:"POST",body:JSON.stringify({bookingId:"booking"})}));
  const response = await invoke();
  return { response, reads, filters, invoke };
}
for (const [active,existing,expected] of [["square",undefined,"square"],["paypal",undefined,"paypal"],["paypal","square","square"],["square","paypal","paypal"],["authorize_net","paypal","paypal"]]) {
  const out=await run({active,existing});
  assert.equal(out.response.status,200);assert.equal((await out.response.json()).provider,expected);
  assert.ok(out.filters.some(([table,key,value])=>table==="bookings"&&key==="renter_profile_id"&&value==="profile"));
}
assert.equal((await run({active:"authorize_net"})).response.status,503);
assert.equal((await run({active:"bad"})).response.status,503);
assert.equal((await run({legacy:true})).response.status,409);
assert.equal((await run({existing:"unknown"})).response.status,409);
assert.equal((await run({lookupError:true})).response.status,503);
const unauthorized=await run({authorized:false});assert.equal(unauthorized.response.status,401);assert.equal(unauthorized.reads,0);
const unowned=await run({owned:false});assert.equal(unowned.response.status,404);assert.equal(unowned.reads,2);
console.log("PASS: actual routing handler authenticates, scopes ownership, preserves payment affinity and fails closed without writes or processor calls.");

// Keep the exact same registered handler and environment callback alive across changes.
// This catches module-level snapshots/caches that per-fixture tests cannot detect.
const runtime = { active: "square" as string | undefined, existing: undefined as string | undefined };
const live = await run(runtime);
assert.equal((await live.response.json()).provider, "square");
for (const active of ["paypal", "square", "paypal"]) {
  runtime.active = active;
  const response = await live.invoke();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).provider, active);
}
for (const original of ["square", "paypal"]) {
  runtime.existing = original;
  for (const active of ["square", "paypal", "authorize_net", "bad", "", undefined]) {
    runtime.active = active;
    const response = await live.invoke();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, original);
  }
}
runtime.existing = undefined;
for (const active of ["authorize_net", "bad", "", " ", "SQUARE", undefined]) {
  runtime.active = active;
  const response = await live.invoke();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /processor is not ready/);
}
console.log("PASS: same handler observes runtime changes; persisted providers survive switches; disabled/invalid selection never falls back.");
