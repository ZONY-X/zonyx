// Simulated provider responses; validates actual committed handler control flow.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {PaymentError,assertPayPalProviderLockReady,assertCardCaptureEligible,standardPayPalEnabled,assertStandardApproval,approvalUrl,customerPayPalEnabled,paypalCents} from '../supabase/functions/_shared/payment-policy.ts';
function fixture({enabled=true,environment='sandbox',operation='awaiting_approval',authorization=false,timeout=false,captured=false,authentication=true,standard=false,orderStatus,missingSource=false,scheduled=false,preparedClaim}={}) {
 let handler;const calls=[];
 const payment={id:'rental',provider:'paypal',environment,state:'paid',booking_id:'booking',agreement_id:'agreement',checkout_method:standard?'paypal_wallet':'card'};
 const deposit={id:'deposit',rental_payment_id:'rental',amount_cents:100,currency:'usd',operation_state:operation,status:'approval_required',provider_order_id:'hold-order',provider_authorization_id:null,authorize_request_id:'stable-hold',create_request_id:'stable-create'};
 const order={id:'hold-order',intent:'AUTHORIZE',status:authorization?'COMPLETED':(orderStatus || (standard?'APPROVED':'CREATED')),purchase_units:[{reference_id:'deposit',custom_id:'deposit',amount:{value:'1.00',currency_code:'USD'},payments:{captures:captured?[{id:'forbidden'}]:[],authorizations:authorization?[{id:'auth',status:'CREATED',amount:{value:'1.00',currency_code:'USD'},create_time:new Date().toISOString(),expiration_time:new Date(Date.now()+86400000*29).toISOString()}]:[]}}],links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=hold-order'}],payment_source:standard?(missingSource?undefined:{paypal:{}}):authentication?{card:{authentication_result:{liability_shift:'POSSIBLE',three_d_secure:{enrollment_status:'Y',authentication_status:'Y'}}}}:undefined};
 const db={from(table){return {select(){return this},eq(){return this},is(){return this},async maybeSingle(){return {data:table==='profiles'?{id:'profile'}:table==='paypal_payment_consents'?{id:'consent',payment_source_id:'source',booking_id:'booking'}:{id:'source',profile_id:'profile',status:'active',environment,vault_token:'test-vault'}}},async single(){return {data:table==='bookings'?{renter_profile_id:'profile'}:deposit}}}}};
 const globals={Request,Response,Headers,URL,JSON,Object,Number,Date,PaymentError,assertPayPalProviderLockReady,assertCardCaptureEligible,standardPayPalEnabled,assertStandardApproval,approvalUrl,customerPayPalEnabled,paypalCents,serve:h=>handler=h,corsHeaders:{},
 env:k=>({SUPABASE_URL:'https://pvowzjqimikcoyjwclez.supabase.co',PAYPAL_ENVIRONMENT:environment,PAYPAL_PROVIDER_LOCK_READY:String(enabled),PAYPAL_SANDBOX_DEPOSIT_ENABLED:String(enabled),PAYPAL_RENTAL_CHECKOUT_ENABLED:'true',PAYPAL_ADVANCED_CARD_ENABLED:standard?'false':'true',PAYPAL_STANDARD_CHECKOUT_ENABLED:String(standard),PAYPAL_CHECKOUT_RETURN_ORIGIN:'http://127.0.0.1:43873'}[k]),
 authenticate:async()=>{calls.push('auth');return{id:'user'}},serviceClient:()=>db,ownedPayment:async()=>payment,validateBooking:async()=>({}),validateRentalEligibility:async()=>{},
 rpc:async(_,name)=>{calls.push(name);if(name==='prepare_paypal_sandbox_deposit'){if(preparedClaim){deposit.operation_state=preparedClaim.deposit.operation_state;deposit.provider_order_id=preparedClaim.deposit.provider_order_id;return {deposit,dispatch:preparedClaim.dispatch}};const dispatch=deposit.operation_state==='idle';if(dispatch){deposit.operation_state='creating';deposit.provider_order_id=null};return {deposit,dispatch}};if(name==='attach_paypal_sandbox_deposit'){deposit.provider_order_id='hold-order';deposit.operation_state='awaiting_approval'};if(name==='claim_paypal_sandbox_authorization')deposit.operation_state='authorizing';return {state:'paid',bookingConfirmed:true,...(scheduled?{depositScheduled:true,depositDueAt:new Date(Date.now()+86400000).toISOString()}: {})}},
 json:(status,body)=>new Response(JSON.stringify(body),{status}),paymentFailure:e=>new Response(JSON.stringify({error:e.message}),{status:e.status||500}),
 PayPalClient:class {environment='sandbox';async createOrder(payload){calls.push(payload);return order}async getOrder(){calls.push('GET');return order}async authorizeOrder(){calls.push('AUTHORIZE');if(timeout)throw new PaymentError(502,'Unknown outcome');order.status='COMPLETED';order.purchase_units[0].payments.authorizations=[{id:'auth',status:'CREATED',amount:{value:'1.00',currency_code:'USD'},create_time:new Date().toISOString(),expiration_time:new Date(Date.now()+86400000*29).toISOString()}]}async captureOrder(){throw new Error('Deposit capture forbidden')}}};
 const context=vm.createContext(globals);
 for(const path of ['supabase/functions/_shared/paypal-deposit.ts','supabase/functions/paypal-deposit/index.ts']) {
  const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import[\s\S]*?;\n/gm,'').replace(/export /g,'');vm.runInContext(compiled,context);
 }
 return{calls,request:action=>handler(new Request('https://sandbox.invalid',{method:'POST',body:JSON.stringify({action,paymentId:'rental',...(action==='auto-authorize'?{paymentSourceId:'source'}:{})})}))};
}
let passed=0;async function check(name,run){await run();console.log('PASS: '+name);passed++}
await check('OFF rejects before authentication or provider',async()=>{const f=fixture({enabled:false});assert.equal((await f.request('authorize')).status,503);assert.deepEqual(f.calls,[])});
await check('LIVE cannot access sandbox authorization route',async()=>{const f=fixture({environment:'live'});assert.equal((await f.request('authorize')).status,503);assert.deepEqual(f.calls,[])});
await check('Verified authorization confirms without capture',async()=>{const f=fixture();assert.equal((await f.request('authorize')).status,200);assert.equal(f.calls.filter(x=>x==='AUTHORIZE').length,1);assert.ok(f.calls.includes('record_paypal_sandbox_authorization'))});
await check('Uncertain authorization retry sends only GET',async()=>{const f=fixture({timeout:true});assert.equal((await f.request('authorize')).status,502);assert.equal((await f.request('authorize')).status,409);assert.equal(f.calls.filter(x=>x==='AUTHORIZE').length,1)});
await check('Already authorized recovery never sends another authorization',async()=>{const f=fixture({authorization:true,operation:'authorizing'});assert.equal((await f.request('status')).status,200);assert.ok(!f.calls.includes('AUTHORIZE'))});
await check('Captured deposit evidence is rejected',async()=>{const f=fixture({captured:true});assert.equal((await f.request('authorize')).status,409);assert.ok(!f.calls.includes('AUTHORIZE'))});
await check('Failed or missing 3DS cannot claim authorization',async()=>{const f=fixture({authentication:false});assert.equal((await f.request('authorize')).status,409);assert.ok(!f.calls.includes('claim_paypal_sandbox_authorization'))});
await check('Standard deposit creation uses AUTHORIZE and PayPal approval, without card fields',async()=>{const f=fixture({standard:true,operation:'idle'});const r=await f.request('create');assert.equal(r.status,200);assert.match((await r.json()).url,/sandbox.paypal.com/);const payload=f.calls.find(x=>typeof x==='object');assert.equal(payload.intent,'AUTHORIZE');assert.ok(payload.payment_source.paypal);assert.equal(payload.payment_source.card,undefined)});
await check('Standard approved deposit authorizes with Advanced Cards OFF',async()=>{const f=fixture({standard:true});assert.equal((await f.request('authorize')).status,200);assert.equal(f.calls.filter(x=>x==='AUTHORIZE').length,1)});
await check('Standard deposit needs canonical buyer approval',async()=>{for(const options of [{orderStatus:'CREATED'},{missingSource:true}]){const f=fixture({standard:true,...options});assert.equal((await f.request('authorize')).status,409);assert.ok(!f.calls.includes('AUTHORIZE'))}});
await check('Uncertain Standard authorization never redispatches',async()=>{const f=fixture({standard:true,timeout:true});assert.equal((await f.request('authorize')).status,502);assert.equal((await f.request('authorize')).status,409);assert.equal(f.calls.filter(x=>x==='AUTHORIZE').length,1)});
await check('Abandoned Standard authorization status sends GET only',async()=>{const f=fixture({standard:true});assert.equal((await f.request('status')).status,200);assert.ok(!f.calls.includes('AUTHORIZE'))});
await check('Lost approval return resumes the original APPROVED deposit without another order',async()=>{const f=fixture({standard:true});const r=await f.request('create');assert.equal(r.status,200);assert.equal((await r.json()).approvalReady,true);assert.ok(!f.calls.some(x=>typeof x==='object'))});
console.log(`${passed} simulated deposit handler checks passed. No provider transaction.`);

await check('Automatic deposit uses the saved card at PayPal card.vault_id and authorizes once',async()=>{
 const f=fixture({operation:'idle'});const response=await f.request('auto-authorize');assert.equal(response.status,200);
 const payload=f.calls.find(x=>typeof x==='object');assert.equal(payload.payment_source.card.vault_id,'test-vault');assert.equal(payload.payment_source.card.stored_credential.payment_initiator,'MERCHANT');assert.equal(payload.payment_source.card.attributes,undefined);assert.equal(f.calls.filter(x=>x==='AUTHORIZE').length,1);
});
await check('Future automatic deposit returns persisted schedule without any provider order or hold',async()=>{
 const f=fixture({operation:'idle',scheduled:true});const response=await f.request('auto-authorize');assert.equal(response.status,200);assert.ok((await response.json()).authorizationDueAt);assert.ok(!f.calls.includes('AUTHORIZE'));assert.ok(!f.calls.some(x=>typeof x==='object'));
});

await check('Already claimed automatic creation never creates or authorizes again',async()=>{
 const f=fixture({operation:'creating'});const r=await f.request('auto-authorize');assert.equal(r.status,409);assert.ok(!f.calls.some(x=>typeof x==='object'));assert.ok(!f.calls.includes('AUTHORIZE'));
});
await check('Lost automatic authorization response never sends a second authorization',async()=>{
 const f=fixture({operation:'idle',timeout:true});assert.equal((await f.request('auto-authorize')).status,502);assert.equal((await f.request('auto-authorize')).status,409);assert.equal(f.calls.filter(x=>x==='AUTHORIZE').length,1);assert.equal(f.calls.filter(x=>typeof x==='object').length,1);
});

await check('Real PostgreSQL prepare RPC returns creating and claims exactly one dispatcher',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const pg=new PGlite();
 try {
 await pg.exec(`CREATE TABLE bookings(id uuid PRIMARY KEY);
 CREATE TABLE booking_payments(id uuid PRIMARY KEY,booking_id uuid,agreement_id uuid,provider text,environment text,state text,capture_id text,paid_at timestamptz,currency text);
 CREATE TABLE booking_rental_agreements(id uuid PRIMARY KEY,trip_financial_summary jsonb);
 CREATE TABLE booking_security_deposits(id uuid PRIMARY KEY,rental_payment_id uuid,generation int,amount_cents bigint,currency text,operation_state text,status text,provider_order_id text);
 INSERT INTO bookings VALUES('11111111-1111-4111-8111-111111111111');
 INSERT INTO booking_rental_agreements VALUES('22222222-2222-4222-8222-222222222222','{"internal_test":false,"authorization_hold_amount_cents":100}');
 INSERT INTO booking_payments VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','paypal','live','paid','capture',now(),'usd');
 INSERT INTO booking_security_deposits VALUES('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',1,100,'usd','idle','disabled',null);`);
 const sql=readFileSync('supabase/migrations/20261010153547_paypal_customer_lifecycle_preparation.sql','utf8');
 const prepare=sql.match(/CREATE OR REPLACE FUNCTION public.prepare_paypal_sandbox_deposit[\s\S]*?END; \$\$;/)[0];
 await pg.exec(prepare);
 const results=await Promise.all([1,2].map(()=>pg.query("select prepare_paypal_sandbox_deposit('33333333-3333-4333-8333-333333333333') as result")));
 const claims=results.map(r=>r.rows[0].result);assert.equal(claims.filter(r=>r.dispatch).length,1);
 const claimed=claims.find(r=>r.dispatch);assert.equal(claimed.deposit.operation_state,'creating');assert.equal(claimed.deposit.provider_order_id,null);
 // Feed the actual SQL transition to the handler, rather than inventing awaiting_approval.
 const f=fixture({preparedClaim:claimed});
 assert.equal((await f.request('auto-authorize')).status,200);assert.equal(f.calls.filter(x=>typeof x==='object').length,1);
 } finally {await pg.close();}
});
