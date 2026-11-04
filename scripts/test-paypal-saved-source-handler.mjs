// Executes the actual checkout handler. All provider I/O and storage are isolated.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import * as policy from '../supabase/functions/_shared/payment-policy.ts';
const sourceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payload={action:'create',method:'card',bookingId:'booking',agreementId:'agreement',paymentSourceId:sourceId};
// Extract the actual frontend create payload's keys; fail if the producer drifts.
const frontend=ts.createSourceFile('PayPalCheckout.tsx',readFileSync('src/pages/PayPalCheckout.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let frontendKeys;
function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(frontend)==='paypalAction'&&node.arguments[0]&&ts.isObjectLiteralExpression(node.arguments[0])){const props=node.arguments[0].properties;if(props.some(p=>p.name?.getText(frontend)==='action'&&p.initializer?.getText(frontend)==='"create"'))frontendKeys=props.map(p=>p.name.getText(frontend)).sort();}ts.forEachChild(node,visit);}visit(frontend);
assert.deepEqual(frontendKeys,Object.keys(payload).sort());
const compiled=ts.transpileModule(readFileSync('supabase/functions/paypal-checkout/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'');
async function run(options={},input=payload){
 let handler,claimed=false;const calls=[],queries=[];
 const payment={id:'payment',booking_id:'booking',agreement_id:'agreement',environment:'live',provider:'paypal',amount_cents:50,currency:'usd',state:'awaiting_approval',order_id:'order',create_request_id:'stable-create',capture_request_id:'stable-capture'};
 const source={id:sourceId,profile_id:'profile',status:'active',environment:'live',vault_token:'synthetic-vault',...options.source};
 const consent={id:'consent',profile_id:'profile',booking_id:'booking',agreement_id:'agreement',...options.consent};
 const db={from(table){const filters=[];return {select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},async maybeSingle(){queries.push({table,filters});return {data:options.missing===table?null:table==='profiles'?{id:'profile'}:table==='paypal_payment_sources'?source:table==='paypal_payment_consents'?consent:null,error:options.error===table?{}:null}}}}};
 class PayPalClient{environment='live';async createOrder(body,key){calls.push({type:'create',body,key});if(options.lost)throw new policy.PaymentError(502,'Unknown create outcome');return {id:'order',intent:'CAPTURE',status:'APPROVED',purchase_units:body.purchase_units,payment_source:body.payment_source}}}
 const globals={...policy,Request,Response,Headers,URL,JSON,Object,Number,Date,PayPalClient,serve:h=>handler=h,env:k=>({PAYPAL_PROVIDER_LOCK_READY:'true',PAYPAL_RENTAL_CHECKOUT_ENABLED:'true',PAYPAL_ADVANCED_CARD_ENABLED:'true',PAYPAL_ENVIRONMENT:'live',PAYPAL_CHECKOUT_RETURN_ORIGIN:'https://www.gozonyx.com'}[k]),authenticate:async()=>({id:'user'}),assertRentalProvider:async()=>{},serviceClient:()=>db,validateBooking:async()=>({grand_total_cents:50}),validateRentalEligibility:async()=>{},rpc:async(_,name)=>{calls.push({type:name});if(name==='paypal_card_checkout_preflight')return new Date(Date.now()+86400000).toISOString();if(name==='prepare_paypal_expanded_payment'){const dispatch=!claimed&&!options.existing;claimed=true;return {payment:{...payment,state:options.existing||payment.state,order_id:options.lost?null:payment.order_id},dispatch}}},json:(status,body)=>new Response(JSON.stringify(body),{status}),corsHeaders:{},paymentFailure:e=>new Response(JSON.stringify({error:e.message}),{status:e.status||500}),fetch:()=>{throw Error('Network forbidden')}};
 vm.runInNewContext(compiled,globals);
 const request=()=>handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(input)}));
 const response=await request();if(options.retry)await request();return {response,calls,queries};
}
let count=0;
async function check(name,options,status,input=payload){const r=await run(options,input);assert.equal(r.response.status,status,`${name}: ${await r.response.text()}`);if(status!==200)assert.equal(r.calls.filter(c=>c.type==='create').length,0,name);count++;return r;}
const good=await check('real frontend payload',{},200);
const create=good.calls.find(c=>c.type==='create');assert.equal(create.body.payment_source.card.vault_id,'synthetic-vault');assert.equal(create.body.intent,'CAPTURE');assert.equal(create.key,'stable-create');assert.equal(create.body.payment_source.card.stored_credential.payment_initiator,'CUSTOMER');
const consentQuery=good.queries.find(q=>q.table==='paypal_payment_consents');for(const pair of [['profile_id','profile'],['booking_id','booking'],['agreement_id','agreement'],['scope','after_trip_charges'],['revoked_at',null]])assert.ok(consentQuery.filters.some(x=>JSON.stringify(x)===JSON.stringify(pair)));
for(const invalid of [null,{},12,'bad-id',''])await check('invalid source identity',{},400,{...payload,paymentSourceId:invalid});
await check('source only on card create',{},400,{...payload,method:'paypal_wallet'});
await check('source unavailable',{missing:'paypal_payment_sources'},409);
for(const source of [{profile_id:'someone-else'},{status:'revoked'},{environment:'sandbox'},{vault_token:''}])await check('source ownership/status/environment/token',{source},409);
await check('source lookup failure',{error:'paypal_payment_sources'},409);
await check('missing or revoked consent',{missing:'paypal_payment_consents'},409);
for(const consent of [{profile_id:'someone-else'},{booking_id:'other-booking'},{booking_id:null},{agreement_id:'old-agreement'}])await check('consent ownership and exact booking/agreement',{consent},409);
await check('consent lookup failure',{error:'paypal_payment_consents'},409);
const retry=await run({retry:true});assert.equal(retry.calls.filter(c=>c.type==='create').length,1);count++;
const lost=await run({lost:true,retry:true});assert.equal(lost.calls.filter(c=>c.type==='create').length,1);count++;
await check('paid booking never redispatches',{existing:'paid'},409);
console.log(`PASS: ${count} actual-handler saved-source checks; frontend payload, authorization, order use, and duplicate/lost-response protection; no network.`);
