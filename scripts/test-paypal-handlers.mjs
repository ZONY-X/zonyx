// Executes the committed handler bodies with injected dependencies. No Deno,
// Supabase credentials or network; this is not deployed Edge Runtime validation.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { PaymentError, assertPayPalProviderLockReady, validatePayPalOrder, approvalUrl, assertCardCaptureEligible } from '../supabase/functions/_shared/payment-policy.ts';
let passed=0;
const payment={id:'fixture-payment',booking_id:'fixture-booking',agreement_id:'fixture-agreement',environment:'sandbox',provider:'paypal',amount_cents:12096,currency:'usd',checkout_method:'paypal_wallet',state:'awaiting_approval',order_id:'fixture-order',capture_request_id:'stable-capture'};
const order={id:'fixture-order',intent:'CAPTURE',status:'APPROVED',purchase_units:[{reference_id:payment.id,custom_id:payment.id,amount:{value:'120.96',currency_code:'USD'}}]};
function fixture(slug,{ready=true,signature=true,seen=false,unknown=false,receiptError=false,state='awaiting_approval',captureTimeout=false,method='paypal_wallet',orderStatus='APPROVED',cardAuthentication,depositStatus='disabled',missingReceipt=false}={}) {
 const calls=[]; const p={...payment,state,checkout_method:method}; const canonicalOrder={...order,status:orderStatus,payment_source:cardAuthentication?{card:{authentication_result:cardAuthentication}}:undefined}; let handler;
 const json=(status,body)=>new Response(JSON.stringify(body),{status});
 const db={from(table){calls.push('db:'+table);return {select(){return this},eq(){return this},async maybeSingle(){return {data:table==='booking_payments'?(unknown?null:p):(seen?{event_id:'event'}:null)}},async upsert(){calls.push('receipt');return {error:receiptError?{}:null}}}}};
 class PayPalClient {environment='sandbox';constructor(){calls.push('provider-client')} async verifyWebhook(){calls.push('verify');return signature} async getOrder(){calls.push('get-order');return canonicalOrder} async captureOrder(id,key){calls.push('capture:'+key);if(captureTimeout)throw new PaymentError(502,'Unknown capture outcome requires reconciliation.')} }
 const globals={Request,Response,Headers,URL,JSON,Object,PaymentError,assertPayPalProviderLockReady,validatePayPalOrder,approvalUrl,assertCardCaptureEligible,PayPalClient,
 serve:h=>handler=h,env:key=>({PAYPAL_PROVIDER_LOCK_READY:String(ready),PAYPAL_RENTAL_CHECKOUT_ENABLED:'true',PAYPAL_ADVANCED_CARD_ENABLED:'true',PAYPAL_WEBHOOK_ID:'synthetic-webhook'}[key]),
 json,corsHeaders:{},authenticate:async()=>{calls.push('auth');return {id:'user'}},serviceClient:()=>{calls.push('db-client');return db},
 ownedPayment:async()=>p,validateBooking:async()=>({}),validateRentalEligibility:async()=>{},
 rpc:async(_,name)=>{calls.push('rpc:'+name);if(name==='claim_paypal_rental_capture')p.state='capturing';if(name==='get_provider_rental_payment_receipt')return missingReceipt?null:{provider:'paypal',state:p.state,depositStatus,bookingConfirmed:false}},
 persistOrderOutcome:async()=>{calls.push('reconcile');return {state:'reconciliation_required',bookingConfirmed:false}},
 paymentFailure:e=>json(e instanceof PaymentError?e.status:500,{error:e instanceof PaymentError?e.message:'Sanitized failure'}),
 fetch:()=>{throw new Error('Network forbidden')}};
 const source=readFileSync(`supabase/functions/${slug}/index.ts`,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'');
 vm.runInNewContext(compiled,globals,{filename:slug});
 return {calls,p,request:body=>handler(new Request('https://sandbox.invalid',{method:'POST',body:JSON.stringify(body)}))};
}
async function check(name,fn){await fn();console.log('PASS: '+name);passed++}
for(const slug of ['paypal-checkout','paypal-webhook'])await check(slug+' OFF rejects before auth/database/provider',async()=>{const f=fixture(slug,{ready:false});assert.equal((await f.request({action:'capture',paymentId:payment.id})).status,503);assert.deepEqual(f.calls,[])});
const event={id:'event',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{supplementary_data:{related_ids:{order_id:'fixture-order'}}}};
await check('Rejected signature never creates database client',async()=>{const f=fixture('paypal-webhook',{signature:false});assert.equal((await f.request(event)).status,400);assert.ok(!f.calls.includes('db-client'))});
await check('Unknown payment requests redelivery without receipt',async()=>{const f=fixture('paypal-webhook',{unknown:true});assert.equal((await f.request(event)).status,409);assert.ok(!f.calls.includes('receipt'))});
await check('Duplicate webhook skips reconciliation and provider order lookup',async()=>{const f=fixture('paypal-webhook',{seen:true});assert.equal((await f.request(event)).status,200);assert.ok(!f.calls.includes('get-order'));assert.ok(!f.calls.includes('reconcile'))});
await check('Receipt failure requests redelivery after reconciliation',async()=>{const f=fixture('paypal-webhook',{receiptError:true});assert.equal((await f.request(event)).status,503);assert.ok(f.calls.includes('reconcile'))});
await check('Refund/reversal only flags review, without capture',async()=>{for(const type of ['PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED']){const f=fixture('paypal-webhook');assert.equal((await f.request({...event,event_type:type})).status,200);assert.ok(f.calls.includes('rpc:record_paypal_payment_state'));assert.ok(!f.calls.includes('get-order'));assert.ok(!f.calls.some(c=>c.startsWith('capture:')))}});
await check('Capture timeout retains claimed state; retry only reads existing order',async()=>{const f=fixture('paypal-checkout',{captureTimeout:true});assert.equal((await f.request({action:'capture',paymentId:payment.id})).status,502);assert.equal(f.p.state,'capturing');assert.equal((await f.request({action:'capture',paymentId:payment.id})).status,200);assert.equal(f.calls.filter(c=>c.startsWith('capture:')).length,1);assert.equal(f.calls.filter(c=>c==='rpc:claim_paypal_rental_capture').length,1)});
await check('Paid payment retry never constructs provider client',async()=>{const f=fixture('paypal-checkout',{state:'paid'});assert.equal((await f.request({action:'capture',paymentId:payment.id})).status,200);assert.ok(!f.calls.includes('provider-client'))});
await check('Paid recovery preserves persisted deposit capability status',async()=>{const f=fixture('paypal-checkout',{state:'paid',depositStatus:'capability_verification_required'});const response=await f.request({action:'status',paymentId:payment.id});assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.depositStatus,'capability_verification_required');assert.equal(receipt.bookingConfirmed,false);assert.ok(!f.calls.includes('provider-client'))});
await check('Missing paid receipt cannot manufacture payment or confirmation evidence',async()=>{const f=fixture('paypal-checkout',{state:'paid',missingReceipt:true});assert.equal((await f.request({action:'status',paymentId:payment.id})).status,409);assert.ok(!f.calls.includes('provider-client'))});
await check('Missing order identity cannot create or capture during recovery',async()=>{const f=fixture('paypal-checkout');f.p.order_id=null;assert.equal((await f.request({action:'status',paymentId:payment.id})).status,409);assert.ok(!f.calls.includes('provider-client'))});
await check('CREATED hosted-card order requires canonical successful 3DS before capture',async()=>{const f=fixture('paypal-checkout',{method:'card',orderStatus:'CREATED',cardAuthentication:{liability_shift:'POSSIBLE',three_d_secure:{enrollment_status:'Y',authentication_status:'Y'}}});assert.equal((await f.request({action:'capture',paymentId:payment.id})).status,200);assert.equal(f.calls.filter(c=>c.startsWith('capture:')).length,1)});
await check('CREATED card without authentication never claims or captures',async()=>{const f=fixture('paypal-checkout',{method:'card',orderStatus:'CREATED'});assert.equal((await f.request({action:'capture',paymentId:payment.id})).status,409);assert.ok(!f.calls.includes('rpc:claim_paypal_rental_capture'));assert.ok(!f.calls.some(c=>c.startsWith('capture:')))});
await check('CREATED wallet cannot use the hosted-card capture path',async()=>{const f=fixture('paypal-checkout',{orderStatus:'CREATED'});assert.equal((await f.request({action:'capture',paymentId:payment.id})).status,409);assert.ok(!f.calls.some(c=>c.startsWith('capture:')))});
console.log(`${passed} mocked handler checks passed; no network or provider transaction.`);
