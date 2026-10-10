// Actual deposit receipt adapter; synthetic service invocation only, no email or provider API.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {PaymentError,paypalCents} from '../supabase/functions/_shared/payment-policy.ts';
const source=ts.transpileModule(readFileSync('supabase/functions/_shared/paypal-deposit.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'').replace(/export /g,'');
const deposit={id:'deposit',amount_cents:75000,currency:'usd',provider_order_id:'order',provider_authorization_id:null};
const order={id:'order',intent:'AUTHORIZE',status:'COMPLETED',purchase_units:[{custom_id:'deposit',reference_id:'deposit',amount:{value:'750.00',currency_code:'USD'},payments:{authorizations:[{id:'authorization',status:'CREATED',amount:{value:'750.00',currency_code:'USD'},create_time:new Date().toISOString(),expiration_time:new Date(Date.now()+29*86400000).toISOString()}]}}]};
async function check({confirmed=true,enabled=true,error=false,environment='live'}={}){
 const calls=[];const receipt={state:'paid',bookingConfirmed:confirmed,depositCapturedAmountCents:0};
 const db={functions:{async invoke(name,request){calls.push({name,request});return{data:{sent:!error},error:error?{}:null}}}};
 const context=vm.createContext({Date,Number,PaymentError,paypalCents,env:()=>String(enabled),rpc:async()=>receipt});vm.runInContext(source,context);
 const result=await context.persistDepositAuthorization(db,{environment,state:'paid',booking_id:'booking'},deposit,order);return{result,calls};
}
let f=await check();assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'send-booking-confirmation');assert.equal(f.calls[0].request.body.bookingId,'booking');assert.equal(f.result.notificationStatus,'sent');
f=await check({confirmed:false});assert.equal(f.calls.length,0);
f=await check({enabled:false});assert.equal(f.calls.length,0);
f=await check({environment:'sandbox'});assert.equal(f.calls.length,0);
f=await check({error:true});assert.equal(f.result.bookingConfirmed,true);assert.equal(f.result.notificationStatus,'pending');
console.log('5 simulated notification checks passed: verified confirmation only; OFF/sandbox send none; failure preserves booking and exposes pending email. No email sent.');
