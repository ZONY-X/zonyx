// Simulated provider responses; validates actual committed handler control flow.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {PaymentError,assertPayPalProviderLockReady,assertCardCaptureEligible,paypalCents} from '../supabase/functions/_shared/payment-policy.ts';
function fixture({enabled=true,environment='sandbox',operation='awaiting_approval',authorization=false,timeout=false,captured=false,authentication=true}={}) {
 let handler;const calls=[];
 const payment={id:'rental',provider:'paypal',environment,state:'paid',booking_id:'booking',agreement_id:'agreement'};
 const deposit={id:'deposit',rental_payment_id:'rental',amount_cents:100,currency:'usd',operation_state:operation,status:'approval_required',provider_order_id:'hold-order',provider_authorization_id:null,authorize_request_id:'stable-hold',create_request_id:'stable-create'};
 const order={id:'hold-order',intent:'AUTHORIZE',status:authorization?'COMPLETED':'CREATED',purchase_units:[{reference_id:'deposit',custom_id:'deposit',amount:{value:'1.00',currency_code:'USD'},payments:{captures:captured?[{id:'forbidden'}]:[],authorizations:authorization?[{id:'auth',status:'CREATED',amount:{value:'1.00',currency_code:'USD'},create_time:new Date().toISOString(),expiration_time:new Date(Date.now()+86400000*29).toISOString()}]:[]}}],payment_source:authentication?{card:{authentication_result:{liability_shift:'POSSIBLE',three_d_secure:{enrollment_status:'Y',authentication_status:'Y'}}}}:undefined};
 const db={from(){return {select(){return this},eq(){return this},async single(){return {data:deposit}}}}};
 const globals={Request,Response,Headers,JSON,Object,Number,Date,PaymentError,assertPayPalProviderLockReady,assertCardCaptureEligible,paypalCents,serve:h=>handler=h,corsHeaders:{},
 env:k=>({SUPABASE_URL:'https://pvowzjqimikcoyjwclez.supabase.co',PAYPAL_ENVIRONMENT:environment,PAYPAL_PROVIDER_LOCK_READY:String(enabled),PAYPAL_SANDBOX_DEPOSIT_ENABLED:String(enabled),PAYPAL_RENTAL_CHECKOUT_ENABLED:'true',PAYPAL_ADVANCED_CARD_ENABLED:'true'}[k]),
 authenticate:async()=>{calls.push('auth');return{id:'user'}},serviceClient:()=>db,ownedPayment:async()=>payment,validateBooking:async()=>({}),validateRentalEligibility:async()=>{},
 rpc:async(_,name)=>{calls.push(name);if(name==='claim_paypal_sandbox_authorization')deposit.operation_state='authorizing';return {state:'paid',bookingConfirmed:true}},
 json:(status,body)=>new Response(JSON.stringify(body),{status}),paymentFailure:e=>new Response(JSON.stringify({error:e.message}),{status:e.status||500}),
 PayPalClient:class {async getOrder(){calls.push('GET');return order}async authorizeOrder(){calls.push('AUTHORIZE');if(timeout)throw new PaymentError(502,'Unknown outcome');order.status='COMPLETED';order.purchase_units[0].payments.authorizations=[{id:'auth',status:'CREATED',amount:{value:'1.00',currency_code:'USD'},create_time:new Date().toISOString(),expiration_time:new Date(Date.now()+86400000*29).toISOString()}]}async captureOrder(){throw new Error('Deposit capture forbidden')}}};
 const context=vm.createContext(globals);
 for(const path of ['supabase/functions/_shared/paypal-deposit.ts','supabase/functions/paypal-deposit/index.ts']) {
  const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import[\s\S]*?;\n/gm,'').replace(/export /g,'');vm.runInContext(compiled,context);
 }
 return{calls,request:action=>handler(new Request('https://sandbox.invalid',{method:'POST',body:JSON.stringify({action,paymentId:'rental'})}))};
}
let passed=0;async function check(name,run){await run();console.log('PASS: '+name);passed++}
await check('OFF rejects before authentication or provider',async()=>{const f=fixture({enabled:false});assert.equal((await f.request('authorize')).status,503);assert.deepEqual(f.calls,[])});
await check('LIVE cannot access sandbox authorization route',async()=>{const f=fixture({environment:'live'});assert.equal((await f.request('authorize')).status,503);assert.deepEqual(f.calls,[])});
await check('Verified authorization confirms without capture',async()=>{const f=fixture();assert.equal((await f.request('authorize')).status,200);assert.equal(f.calls.filter(x=>x==='AUTHORIZE').length,1);assert.ok(f.calls.includes('record_paypal_sandbox_authorization'))});
await check('Uncertain authorization retry sends only GET',async()=>{const f=fixture({timeout:true});assert.equal((await f.request('authorize')).status,502);assert.equal((await f.request('authorize')).status,409);assert.equal(f.calls.filter(x=>x==='AUTHORIZE').length,1)});
await check('Already authorized recovery never sends another authorization',async()=>{const f=fixture({authorization:true,operation:'authorizing'});assert.equal((await f.request('status')).status,200);assert.ok(!f.calls.includes('AUTHORIZE'))});
await check('Captured deposit evidence is rejected',async()=>{const f=fixture({captured:true});assert.equal((await f.request('authorize')).status,409);assert.ok(!f.calls.includes('AUTHORIZE'))});
await check('Failed or missing 3DS cannot claim authorization',async()=>{const f=fixture({authentication:false});assert.equal((await f.request('authorize')).status,409);assert.ok(!f.calls.includes('claim_paypal_sandbox_authorization'))});
console.log(`${passed} simulated deposit handler checks passed. No provider transaction.`);
