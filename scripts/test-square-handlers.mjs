// Real committed handler bodies, injected services. No network or credentials.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {PaymentError} from '../supabase/functions/_shared/payment-policy.ts';
import {assertSquareSandbox,squareSetting,verifySquareSignature} from '../supabase/functions/_shared/square-policy.ts';
let passed=0;
function fixture(slug,{off=false,signature=true,existing=false,dispatch=true,timeout=false}={}) {
 const calls=[];let handler;
 const p={id:'payment',booking_id:'booking',agreement_id:'agreement',provider:'square',environment:'sandbox',amount_cents:12096,state:'creating',create_request_id:'stable-hold',capture_request_id:'stable-rental'};
 const json=(status,body)=>new Response(JSON.stringify(body),{status});
 const db={from(table){calls.push('db:'+table);return {select(){return this},eq(){return this},async maybeSingle(){return {data:existing?{id:'payment',provider:'paypal'}:null,error:null}},async single(){return {data:table==='square_payment_operations'?{rental_started:false,cancel_requested:false}:{status:'authorized',expires_at:new Date(Date.now()+86400000).toISOString()},error:null}}}}};
 class SquareClient {async create(input){calls.push('create:'+input.key);if(timeout)throw new PaymentError(502,'Unknown Square outcome requires reconciliation.');return {id:'external'}}async get(){calls.push('get');return {id:'external'}}}
 const globals={Request,Response,JSON,Object,Date,PaymentError,URL,SquareClient,assertSquareSandbox,squareSetting,
 serve:h=>handler=h,env:key=>({SQUARE_CHECKOUT_ENABLED:off?'false':'true',SQUARE_WEBHOOK_ENABLED:off?'false':'true',SQUARE_OPERATIONS_ENABLED:off?'false':'true',SQUARE_BUSINESS_ELIGIBILITY_VERIFIED:'true',SQUARE_PROVIDER_LOCK_READY:'true',SQUARE_ENVIRONMENT:'sandbox',SQUARE_SANDBOX_PROJECT_URL:'https://pvowzjqimikcoyjwclez.supabase.co',SUPABASE_URL:'https://pvowzjqimikcoyjwclez.supabase.co',SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY:'synthetic',SQUARE_SANDBOX_WEBHOOK_URL:'https://fixture.invalid',SQUARE_SANDBOX_MERCHANT_ID:'merchant'}[key]),
 json,corsHeaders:{},squareUser:async()=>{calls.push('auth');return {id:'user'}},serviceClient:()=>{calls.push('service');return db},squareBooking:async()=>({id:'booking',grand_total_cents:12096,depositAmountCents:50000}),squarePreflight:async()=>{calls.push('preflight')},squareOwned:async()=>p,
 squareRecord:async()=>{calls.push('record')},squareStatus:async()=>{calls.push('status-get');return {paymentId:p.id,state:'reconciliation_required',bookingConfirmed:false}},
 rpc:async(_,name)=>{calls.push('rpc:'+name);if(name==='prepare_square_payment')return {payment:p,deposit:{id:'deposit',amount_cents:50000},dispatch};if(name==='claim_square_step')return {dispatch}},
 verifySquareSignature:async()=>{calls.push('signature');return signature},paymentFailure:e=>json(e instanceof PaymentError?e.status:500,{error:e instanceof PaymentError?e.message:'Sanitized'}),fetch:()=>{throw new Error('Network forbidden')}};
 const source=readFileSync(`supabase/functions/${slug}/index.ts`,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'');
 vm.runInNewContext(compiled,globals);
 return {calls,request:input=>handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(input)}))};
}
async function check(name,fn){await fn();passed++;console.log('PASS: '+name);}
for(const slug of ['square-checkout','square-booking-operations','square-webhook'])await check(slug+' gates OFF prevent all side effects',async()=>{const f=fixture(slug,{off:true});assert.equal((await f.request({})).status,503);assert.deepEqual(f.calls,[])});
await check('Invalid signature rejected before database',async()=>{const f=fixture('square-webhook',{signature:false});assert.equal((await f.request({event_id:'fake'})).status,400);assert.deepEqual(f.calls,['signature'])});
await check('Existing PayPal ownership cannot become Square',async()=>{const f=fixture('square-checkout',{existing:true});assert.equal((await f.request({action:'hold',bookingId:'booking',agreementId:'agreement',token:'cnon:fake'})).status,409);assert.ok(!f.calls.some(c=>c.startsWith('create:')))});
await check('Unknown hold outcome retains only one claimed POST',async()=>{const f=fixture('square-checkout',{timeout:true});assert.equal((await f.request({action:'hold',bookingId:'booking',agreementId:'agreement',token:'cnon:fake'})).status,502);assert.equal(f.calls.filter(c=>c.startsWith('create:')).length,1);assert.ok(f.calls.indexOf('rpc:prepare_square_payment')<f.calls.indexOf('create:stable-hold'))});
await check('Hold retry reads existing status without another token dispatch',async()=>{const f=fixture('square-checkout',{dispatch:false});assert.equal((await f.request({action:'hold',bookingId:'booking',agreementId:'agreement',token:'cnon:fake'})).status,200);assert.ok(!f.calls.some(c=>c.startsWith('create:')))});
await check('Rental retry cannot dispatch a second charge',async()=>{const f=fixture('square-checkout',{dispatch:false});assert.equal((await f.request({action:'rental',paymentId:'payment',token:'cnon:fake'})).status,200);assert.ok(!f.calls.some(c=>c.startsWith('create:')))});
await check('Caller amounts rejected before financial claims',async()=>{const f=fixture('square-checkout');assert.equal((await f.request({action:'hold',amount:1})).status,400);assert.ok(!f.calls.includes('service'))});
await check('Signed LIVE hold webhook resolves attempt identity and reconciles its rental',async()=>{
 let handler;const calls=[];
 const reference='11111111-1111-4111-8111-111111111111',paymentId='22222222-2222-4222-8222-222222222222';
 const url='https://fazzuetfwwfiqehpnjky.supabase.co/functions/v1/square-webhook',key='synthetic-live-key';
 const body=JSON.stringify({event_id:'live-hold-event',merchant_id:'merchant',type:'payment.updated',data:{object:{payment:{id:'hold'}}}});
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(url+body))).toString('base64');
 const db={from(table){calls.push('db:'+table);return {select(){return this},eq(){return this},async maybeSingle(){return{data:table==='square_deposit_attempts'?{payment_id:paymentId}:null,error:null}},async single(){return{data:{id:paymentId,provider:'square',environment:'live'},error:null}},async upsert(){calls.push('receipt');return{error:null}}}}};
 const values={SQUARE_ENVIRONMENT:'live',SUPABASE_URL:'https://fazzuetfwwfiqehpnjky.supabase.co',SQUARE_WEBHOOK_ENABLED:'true',SQUARE_PROVIDER_LOCK_READY:'true',SQUARE_LIVE_WEBHOOK_SIGNATURE_KEY:key,SQUARE_LIVE_WEBHOOK_URL:url,SQUARE_LIVE_MERCHANT_ID:'merchant'};
 const globals={Request,Response,JSON,Object,Date,PaymentError,URL,fetch:()=>{throw new Error('External network forbidden')},assertSquareSandbox,squareSetting,verifySquareSignature,serve:h=>handler=h,env:k=>values[k],json:(s,b)=>new Response(JSON.stringify(b),{status:s}),serviceClient:()=>db,
 SquareClient:class{async get(id){calls.push('get:'+id);return{id,reference_id:reference}}},squareRecord:async(_db,_client,p,hold,canonical)=>{assert.equal(p.id,paymentId);assert.equal(hold,true);assert.equal(canonical.reference_id,reference);calls.push('record-hold')},rpc:async(_db,name)=>{calls.push('rpc:'+name)},paymentFailure:e=>new Response(JSON.stringify({error:e.message}),{status:e.status||500})};
 const source=ts.transpileModule(readFileSync('supabase/functions/square-webhook/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'');
 vm.runInNewContext(source,globals);
 const result=await handler(new Request(url,{method:'POST',body,headers:{'x-square-hmacsha256-signature':signature}}));
 assert.equal(result.status,200);assert.ok(calls.includes('record-hold'));assert.ok(calls.includes('rpc:reconcile_square_booking'));assert.ok(calls.includes('receipt'));
});
console.log(`${passed} Square handler simulations passed. No external transaction.`);
