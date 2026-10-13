import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RENEWAL_MODULE } from './renewal-checkout.ts';
const source = readFileSync('supabase/functions/stripe-webhook/index.ts','utf8').replace(/^import .*;\n/gm,'');
let handler: (req:Request)=>Promise<Response>;let holds=0,renewals=0;
const env:Record<string,string>={STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key'};
class FakeStripe { static createFetchHttpClient(){return{};} }
const run=new Function('serve','createHmac','timingSafeEqual','createAuthorizationHoldForCheckoutSession','Stripe','RENEWAL_MODULE','settleRenewalSession','createClient','Deno',stripTypeScriptTypes(source));
run((h:typeof handler)=>handler=h,createHmac,timingSafeEqual,async()=>{holds++;return{};},FakeStripe,RENEWAL_MODULE,async()=>{renewals++;return{state:'paid'};},()=>({}),{env:{get:(name:string)=>env[name]}});
const invoke=async(type:string,renewal:boolean,age=0,broken=false)=>{const payload=JSON.stringify({type,data:{object:{id:'cs_test_fixture',metadata:renewal?{zonyxFlow:RENEWAL_MODULE,renewalPeriodId:'period-fixture'}:{bookingId:'booking-fixture'}}}});const ts=Math.floor(Date.now()/1000)-age;const sig=createHmac('sha256','whsec_fixture').update(`${ts}.${payload}`).digest('hex');return handler(new Request('https://fixture.invalid',{method:'POST',headers:{'stripe-signature':`t=${ts},v1=${broken?'0'.repeat(64):sig}`},body:payload}));};
assert.equal((await invoke('checkout.session.completed',true)).status,200);assert.equal(holds,0);assert.equal(renewals,1);
assert.equal((await invoke('checkout.session.async_payment_succeeded',true)).status,200);assert.equal(holds,0);assert.equal(renewals,2);
assert.equal((await invoke('checkout.session.completed',true,601)).status,400);assert.equal(renewals,2);
assert.equal((await invoke('checkout.session.completed',true,0,true)).status,400);assert.equal(renewals,2);
assert.equal((await invoke('payment_intent.succeeded',true)).status,200);assert.equal(holds,0);
assert.equal((await invoke('checkout.session.completed',false)).status,200);assert.equal(holds,1);assert.equal(renewals,2);
console.log('PASS: signed renewal webhook isolation, async settlement, replay rejection, invalid signatures, and unchanged original rental/HOLD path.');
