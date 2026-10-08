import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { verifySandboxStripeSignature } from '../supabase/functions/stripe-checkout-sandbox/webhook-policy.ts';
function setup(slug,{ready=true,existing=false,conflict=false,dispatch=false}={}){
 let handler; const calls=[]; let clients=0;
 const booking={id:'booking',trip_status:'pending_payment',grand_total_cents:12096,stripe_checkout_session_id:existing?'cs_test_fixture':null};
 const agreement={id:'agreement',accepted_at:'synthetic',guest_auth_user_id:'user',trip_financial_summary:{rental_days:1,internal_test:true}};
 const env=key=>{calls.push('env:'+key);return {PAYPAL_PROVIDER_LOCK_READY:String(ready),PAYPAL_ENVIRONMENT:'sandbox',SUPABASE_URL:'https://pvowzjqimikcoyjwclez.supabase.co',STRIPE_SECRET_KEY:'sk_test_synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon',PAYPAL_SANDBOX_BOOKING_IDS:'booking'}[key]};
 const db={auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:table=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:table==='booking_rental_agreements'?agreement:booking})}),rpc:async name=>{calls.push(name);return {data:name==='reserve_rental_payment_provider'?{id:'payment',create_request_id:'stable',order_id:existing?'cs_test_fixture':null}:dispatch,error:conflict&&name==='reserve_rental_payment_provider'?{}:null}}};
 const context={Request,Response,JSON,URL,URLSearchParams,Number,Object,Array,console:{error(){}},verifySandboxStripeSignature,Deno:{env:{get:env}},serve:h=>handler=h,createClient:()=>{clients++;return db},fetch:async(url,opts)=>{calls.push('fetch:'+String(url));assert.equal(opts?.method,undefined);return new Response(JSON.stringify({id:'cs_test_fixture',livemode:false,metadata:{bookingId:'booking'},amount_total:12096,currency:'usd',url:'https://checkout.stripe.com/synthetic'}))}};
 const src=ts.transpileModule(readFileSync(`supabase/functions/${slug}/index.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'');vm.runInNewContext(src,context);
 return {calls,clients:()=>clients,request:()=>handler(new Request('https://sandbox.invalid',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({bookingId:'booking',agreementId:'agreement'})}))};
}
for(const slug of ['stripe-checkout-sandbox','stripe-webhook-sandbox']){const f=setup(slug,{ready:false});assert.equal((await f.request()).status,503);assert.equal(f.clients(),0);assert.ok(!f.calls.includes('env:STRIPE_SECRET_KEY'));assert.ok(!f.calls.some(x=>x.startsWith('fetch:')))}
const unknown=setup('stripe-checkout-sandbox');assert.equal((await unknown.request()).status,409);assert.ok(!unknown.calls.some(x=>x.startsWith('fetch:')));
const conflict=setup('stripe-checkout-sandbox',{conflict:true,existing:true});assert.equal((await conflict.request()).status,409);assert.ok(!conflict.calls.some(x=>x.startsWith('fetch:')));
const reuse=setup('stripe-checkout-sandbox',{existing:true});assert.equal((await reuse.request()).status,200);assert.ok(reuse.calls.indexOf('reserve_rental_payment_provider')<reuse.calls.findIndex(x=>x.startsWith('fetch:')));assert.ok(reuse.calls.includes('attach_sandbox_stripe_session'));assert.ok(!reuse.calls.includes('claim_sandbox_stripe_dispatch'));
console.log('5 sandbox handler scenarios passed: OFF before credential access, unknown outcome no POST, provider conflict before reuse, canonical existing-session recovery.');
