// Runs the actual handler with isolated storage and provider responses.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {PaymentError,validatePayPalOrder} from '../supabase/functions/_shared/payment-policy.ts';
async function run({state='paid',vaultStatus='VAULTED',owner=true,amount='0.50',captureStatus='COMPLETED',duplicate=false}={}) {
 let handler;const writes=[],provider=[];
 const booking='11111111-1111-4111-8111-111111111111';
 const payment={id:'payment',state,booking_id:booking,environment:'live',order_id:'order',capture_id:'capture',amount_cents:50,currency:'usd'};
 const order={id:'order',intent:'CAPTURE',status:'COMPLETED',payment_source:{card:{attributes:{vault:{id:'vault-token',status:vaultStatus}}}},purchase_units:[{reference_id:'payment',custom_id:'payment',amount:{currency_code:'USD',value:amount},payments:{captures:[{id:'capture',status:captureStatus,amount:{currency_code:'USD',value:amount}}]}}]};
 const db={from(table){let mode='select';const chain={select(){return this},eq(){return this},not(){return this},order(){return this},limit(){return this},insert(value){mode='insert';writes.push({table,value});return this},update(value){mode='update';writes.push({table,value});return this},async single(){return {data:{id:'source'}}},async maybeSingle(){return {data:table==='profiles'?{id:'profile'}:table==='bookings'?{id:booking,renter_profile_id:owner?'profile':'other'}:table==='booking_rental_agreements'?{id:'agreement'}:table==='paypal_vault_requests'?{payment_source_id:'source'}:table==='paypal_payment_sources'?{id:'source'}:{id:'consent'}}},then(resolve){return Promise.resolve({error:duplicate&&table==='paypal_vault_requests'&&mode==='insert'?{code:'23505'}:null}).then(resolve)}};return chain}};
 const globals={Request,Response,Headers,JSON,Object,Number,Date,Set,TextEncoder,crypto:webcrypto,PaymentError,validatePayPalOrder,serve:h=>handler=h,corsHeaders:{},env:k=>k==='PAYPAL_ENVIRONMENT'?'live':'true',authenticate:async()=>({id:'user'}),ownedPayment:async()=>payment,serviceClient:()=>db,json:(status,b)=>new Response(JSON.stringify(b),{status}),paymentFailure:e=>new Response(JSON.stringify({error:e.message}),{status:e.status||500}),PayPalClient:class {environment='live';async getOrder(){provider.push('GET');return order}async exchangeVaultSetupToken(){throw Error('Exchange must not be called for a captured card')}}};
 const code=ts.transpileModule(readFileSync('supabase/functions/paypal-vault/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'');vm.runInNewContext(code,globals);
 const response=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({action:'store-payment-token',paymentId:'payment',bookingId:booking,scope:'after_trip_charges',categories:['tolls'],termsVersion:'v1',consentText:'I authorize saving my card for this rental and its security deposit.'})}));return {response,writes,provider};
}
let r=await run();assert.equal(r.response.status,200);assert.deepEqual(r.provider,['GET']);assert.equal(r.writes.find(x=>x.table==='paypal_payment_sources').value.vault_token,'vault-token');
for(const options of [{state:'capturing'},{vaultStatus:'APPROVED'},{owner:false},{amount:'1.00'},{captureStatus:'PENDING'}]){r=await run(options);assert.equal(r.response.status,409===r.response.status?409:404);assert.equal(r.writes.length,0);}
r=await run({duplicate:true});assert.equal(r.response.status,200);assert.equal((await r.response.json()).duplicate,true);assert.equal(r.writes.filter(x=>x.table==='paypal_payment_sources').length,0);
console.log('PASS: captured-card vault validates ownership, exact capture, amount, status, pending vault and duplicate retry; provider GET only.');
