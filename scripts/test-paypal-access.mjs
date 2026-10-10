// Actual auth/ownership adapter with synthetic DB/JWT responses, no network.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {PaymentError,assertAmountIntegrity,assertInternalCheckout,customerPayPalEnabled} from '../supabase/functions/_shared/payment-policy.ts';
const source=ts.transpileModule(readFileSync('supabase/functions/_shared/payment-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'').replace(/export /g,'');
function fixture({customer=true,gate=true,owner=true,internal=false,changedAmount=false,managed=true,invalidJwt=false,operationsOnly=false}={}) {
 const flags=customer?{PAYPAL_CUSTOMER_CHECKOUT_ENABLED:String(gate),PAYPAL_CUSTOMER_RELEASE_VERIFIED:'true',PAYPAL_ENVIRONMENT:'live',PAYPAL_LIVE_RENTAL_PAYMENT_ENABLED:'true',PAYPAL_DEPOSIT_AUTHORIZATION_ENABLED:'true'}:{PAYPAL_ENVIRONMENT:'sandbox',ZONYX_INTERNAL_TEST_ENABLED:'true',ZONYX_INTERNAL_TEST_EMAIL:'approved@example.invalid'};
 flags.PAYPAL_RENTAL_CHECKOUT_ENABLED='true';flags.PAYPAL_MANAGED_VEHICLE_IDS=managed?'vehicle':'';
 if(operationsOnly){flags.PAYPAL_CUSTOMER_CHECKOUT_ENABLED='false';flags.PAYPAL_LIVE_RENTAL_PAYMENT_ENABLED='false';flags.PAYPAL_LIVE_OPERATIONS_ENABLED='true'}
 const user={id:'owner',email:'other@example.invalid',user_metadata:{is_admin:true,is_internal_tester:true}};
 const booking={id:'booking',renter_profile_id:owner?'profile':'different',vehicle_id:'vehicle',grand_total_cents:108,subtotal_cents:100,service_fee_cents:0,taxes_cents:8,currency:'usd',terms_accepted_at:'accepted',rental_agreement_accepted_at:'accepted'};
 const agreement={accepted_at:'accepted',guest_auth_user_id:'owner',document_hash:'hash',trip_financial_summary:{internal_test:internal,final_total_cents:changedAmount?999:108,subtotal_cents:100,service_fee_cents:0,taxes_cents:8,currency:'usd'}};
 const db={from(table){return{select(){return this},eq(){return this},async single(){return{data:table==='profiles'?{id:'profile',is_internal_tester:internal,is_admin:false}:table==='bookings'?booking:agreement}}}}};
 const context=vm.createContext({Request,Response,Headers,JSON,Object,Number,String,PaymentError,assertAmountIntegrity,assertInternalCheckout,customerPayPalEnabled,Deno:{env:{get:k=>flags[k]}},createClient:()=>({auth:{getUser:async()=>({data:{user:invalidJwt?null:user},error:invalidJwt?{}:null})}})});vm.runInContext(source,context);
 const request=new Request('https://fixture.invalid',{headers:{Authorization:'Bearer synthetic-jwt'}});
 return{authenticate:()=>context.authenticate(request,operationsOnly),booking:()=>context.validateBooking(db,'booking','agreement','owner')};
}
let passed=0;async function check(name,run){await run();console.log('PASS: '+name);passed++}
await check('Customer adapter accepts verified owner and immutable normal terms behind all gates',async()=>{const f=fixture();assert.equal((await f.authenticate()).id,'owner');assert.equal((await f.booking()).id,'booking')});
await check('Missing customer gate rejects despite spoofed user_metadata flags',async()=>{await assert.rejects(fixture({gate:false}).authenticate(),/configured internal tester/)});
await check('Invalid current JWT cannot authenticate',async()=>{await assert.rejects(fixture({invalidJwt:true}).authenticate(),/Invalid authentication/)});
await check('Different booking owner rejected before financial actions',async()=>{await assert.rejects(fixture({owner:false}).booking(),/Booking not found/)});
await check('Customer cannot use synthetic test agreement',async()=>{await assert.rejects(fixture({internal:true}).booking(),/internal test terms/)});
await check('Customer immutable accepted amount cannot be changed',async()=>{await assert.rejects(fixture({changedAmount:true}).booking(),/financial terms/)});
await check('Unapproved inventory cannot use customer checkout',async()=>{await assert.rejects(fixture({managed:false}).booking(),/Vehicle is not approved/)});
await check('Authenticated recovery remains available when new customer checkout is OFF',async()=>{assert.equal((await fixture({operationsOnly:true}).authenticate()).id,'owner')});
console.log(`${passed} synthetic customer access checks passed; LIVE API was never contacted.`);
