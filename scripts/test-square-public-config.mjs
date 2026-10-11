import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync('supabase/functions/square-public-config/index.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import.*;\n/gm,'');
function fixture(overrides={},ok=true){let handler;const calls=[];const values={SUPABASE_PUBLISHABLE_KEYS:'{"default":"public"}',SUPABASE_URL:'https://fazzuetfwwfiqehpnjky.supabase.co',SQUARE_INSTALLED:'true',SQUARE_ENVIRONMENT:'live',SQUARE_LIVE_APPLICATION_ID:'sq0idp-fixture',SQUARE_LIVE_ACCESS_TOKEN:'private-fixture',...overrides};vm.runInNewContext(source,{serve:h=>handler=h,Deno:{env:{get:k=>values[k]}},Request,Response,AbortSignal,Date,JSON,Object,fetch:async(url,options)=>{calls.push({url,method:options.method});return new Response(JSON.stringify({locations:[{id:'location',status:'ACTIVE',currency:'USD'}]}),{status:ok?200:403})}});return{calls,request:(method='GET',key='public')=>handler(new Request('https://fixture.invalid',{method,headers:{apikey:key}}))}}
let f=fixture();assert.equal((await f.request('POST')).status,405);assert.equal((await f.request('GET','invalid')).status,401);assert.equal(f.calls.length,0);
f=fixture({SQUARE_INSTALLED:'false'});assert.equal((await f.request()).status,503);assert.equal(f.calls.length,0);
f=fixture();const result=await(await f.request()).json();assert.equal(result.paymentsEnabled,false);assert.equal(result.depositCaptureEnabled,false);assert.equal(result.depositMaximumDays,7);assert.equal(result.locationId,'location');assert.ok(!JSON.stringify(result).includes('private-fixture'));await f.request();assert.deepEqual(f.calls,[{url:'https://connect.squareup.com/v2/locations',method:'GET'}]);
f=fixture({},false);assert.equal((await f.request()).status,503);
f=fixture({SUPABASE_PUBLISHABLE_KEYS:'broken'});assert.equal((await f.request()).status,401);
console.log('PASS: read-only production config, authentication, disabled payments, provider failure, caching, no credential exposure.');
