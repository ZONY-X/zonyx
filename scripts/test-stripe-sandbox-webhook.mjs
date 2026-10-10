import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifySandboxStripeSignature} from '../supabase/functions/stripe-checkout-sandbox/webhook-policy.ts';
// Synthetic key, event, API responses and DB adapter. No network or credentials.
function fixture({invalidSignature=false,live=false,readStatus=200,unpaid=false,wrongBooking=false,wrongAmount=false,dbConflict=false}={}) {
 let handler;const calls=[];
 const event={id:'evt_synthetic',type:'checkout.session.completed',livemode:live,data:{object:{id:'cs_test_synthetic'}}};
 const raw=JSON.stringify(event),t=Math.floor(Date.now()/1000),secret='whsec_synthetic_fixture';
 const signature=createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex');
 const db={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'payment',booking_id:'booking',amount_cents:108,currency:'usd'}})}),rpc:async(name,args)=>{calls.push({name,args});return {error:dbConflict?{}:null}}};
 const context={Request,Response,JSON,Date,Number,console,verifySandboxStripeSignature,Deno:{env:{get:k=>({PAYPAL_PROVIDER_LOCK_READY:'true',PAYPAL_ENVIRONMENT:'sandbox',SUPABASE_URL:'https://pvowzjqimikcoyjwclez.supabase.co',STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_SANDBOX_WEBHOOK_SECRET:secret,SUPABASE_SERVICE_ROLE_KEY:'synthetic'})[k]}},serve:h=>handler=h,createClient:()=>{calls.push({name:'database'});return db},fetch:async(url,opts)=>{assert.equal(opts.method,undefined);calls.push({name:'GET',url});return new Response(JSON.stringify({id:'cs_test_synthetic',livemode:false,status:'complete',payment_status:unpaid?'unpaid':'paid',payment_intent:'pi_synthetic',metadata:{bookingId:wrongBooking?'other':'booking'},amount_total:wrongAmount?109:108,currency:'usd'}),{status:readStatus})}};
 const source=ts.transpileModule(readFileSync('supabase/functions/stripe-webhook-sandbox/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'');vm.runInNewContext(source,context);
 return {calls,run:()=>handler(new Request('https://sandbox.invalid',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${invalidSignature?'00':signature}`},body:raw}))};
}
for(const options of [{invalidSignature:true},{live:true}]){const f=fixture(options);assert.equal((await f.run()).status,400);assert.equal(f.calls.length,0);}
for(const [options,status] of [[{readStatus:401},503],[{unpaid:true},409],[{wrongBooking:true},409],[{wrongAmount:true},409],[{dbConflict:true},409]]){const f=fixture(options);assert.equal((await f.run()).status,status);if(!options.dbConflict)assert.ok(!f.calls.some(c=>c.name==='finalize_sandbox_stripe_payment'));}
const success=fixture();assert.equal((await success.run()).status,200);assert.equal((await success.run()).status,200);const settlements=success.calls.filter(c=>c.name==='finalize_sandbox_stripe_payment');assert.equal(settlements.length,2);assert.deepEqual(JSON.parse(JSON.stringify(settlements[0].args)),JSON.parse(JSON.stringify(settlements[1].args)));assert.equal(settlements[0].args._amount_cents,108);assert.equal(settlements[0].args._capture_id,'pi_synthetic');assert.ok(success.calls.filter(c=>c.name==='GET').every(c=>c.url.endsWith('/cs_test_synthetic')));
console.log('8 simulated Stripe webhook cases passed: signed success/redelivery, invalid signature, LIVE rejection, expired credential, unpaid, identity/amount conflict, DB conflict. No actual provider integration.');
