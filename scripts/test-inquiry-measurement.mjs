import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const raw = readFileSync('src/lib/measurement/google.ts','utf8').replace(/^import .*;\n/, '').replaceAll('import.meta.env','ENV');
const code = ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({choice='granted',paid=false,enabled=true}={}) {
  const events=[], local = new Map(), session = new Map();
  local.set('zonyx:google-consent:v1',JSON.stringify({choice,expires:Date.now()+100000}));
  const storage = map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)});
  const window={location:new URL(`https://www.gozonyx.com/vehicle/test-miami${paid?'?gclid=synthetic':''}`),addEventListener(){},removeEventListener(){}};
  const context={ENV:{VITE_GA4_MANUAL_EVENTS_READY:enabled?'true':'false',VITE_GA4_MEASUREMENT_ID:'G-SYNTHETIC'},exports:{},window,document:{referrer:'https://www.google.com/search?q=private-query',createElement:()=>({remove(){}}),head:{appendChild(script){queueMicrotask(()=>script.onload());}}},navigator:{doNotTrack:'0'},localStorage:storage(local),sessionStorage:storage(session),URL,URLSearchParams,AbortSignal,Date,Map,Set,JSON,Object,Number,String,fetch:async()=>({ok:false}),isPurchaseEligible:()=>false};
  vm.runInNewContext(code,context);
  context.exports.initializeMeasurement();
  // Keep the real queue/bootstrap; inspect only events queued by the module.
  return {api:context.exports,events:()=>window.dataLayer?.map(x=>Array.from(x)).filter(x=>x[0]==='event')||[]};
}
let f=fixture(); await f.api.startMeasurement(); await f.api.trackContactIntent('phone_click'); await f.api.trackContactIntent('whatsapp_click');
let events=f.events(); assert.equal(events.filter(x=>x[1]==='phone_click').length,1); assert.equal(events.filter(x=>x[1]==='whatsapp_click').length,1);
assert(!events.some(x=>['purchase','conversion'].includes(x[1])));
for(const event of events) { assert.equal(event[2].send_to,'G-SYNTHETIC'); assert(!JSON.stringify(event).includes('private-query')); }
assert.equal(events.find(x=>x[1]==='phone_click')[2].inquiry_source,'organic_search');
assert.equal(events.find(x=>x[1]==='phone_click')[2].completed_call,false);
f=fixture({paid:true});await f.api.startMeasurement();await f.api.trackContactIntent('phone_click');assert.equal(f.events().find(x=>x[1]==='phone_click')[2].inquiry_source,'paid');
for(const options of [{choice:'denied'},{enabled:false}]) { f=fixture(options);await f.api.trackContactIntent('phone_click');assert.equal(f.events().length,0); }
console.log('PASS: inquiry events respect consent, distinguish paid/organic, exclude query strings, and never emit purchases or Ads conversions.');
