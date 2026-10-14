import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {squareRenewalEvidence} from './square-renewal.ts';
import {CARD_TERMS_VERSION,authorizationTerms,validatePayer} from './square-card-authorization.ts';
let handler:(r:Request)=>Promise<Response>;let creates=0,claims=0,dispatch=false,detailsPaid=false,attempt:Record<string,unknown>|null=null,consent:Record<string,unknown>|null=null;
const id='11111111-1111-4111-8111-111111111111',submission='22222222-2222-4222-8222-222222222222';
const env:Record<string,string>={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',SQUARE_ENVIRONMENT:'live',SQUARE_LIVE_APPLICATION_ID:'sq0idp-fixture'};
const payer={givenName:'Test',familyName:'Payer',email:'payer@example.invalid',postalCode:'10003',country:'US'};
const payment={id:'square-id',reference_id:id,location_id:'location',status:'COMPLETED',source_type:'CARD',amount_money:{amount:100,currency:'USD'},customer_id:'customer'};
class FakeSquare{location='location';async cardOnFileReadiness(){return{verified:true};}async create(input:{amount:number;hold:boolean;customerId:string}){creates++;assert.equal(input.amount,100);assert.equal(input.hold,false);assert.equal(input.customerId,'customer');return payment;}async get(){return payment;}async find(){return payment;}async disableCard(){return{id:'ccof:card',enabled:false};}}
class Declined extends Error{}
const details=()=>({test_id:'test',can_pay:!detailsPaid,amount_cents:100,live_test:true,payment_status:detailsPaid?'paid':'payment_due',paid_at:detailsPaid?'2098-01-01':null});
const createClient=()=>({auth:{getUser:async()=>{throw Error('Public checkout must not authenticate');}},from:(table:string)=>{let q:Record<string,unknown>;q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:table==='square_checkout_authorizations'?consent:attempt,error:null}),update:(fields:Record<string,unknown>)=>({eq:async()=>{consent={...consent,...fields};return{error:null};}})};return q;},rpc:async(name:string,args:Record<string,unknown>)=>{
 if(name==='get_square_live_test_details'||name==='get_public_square_renewal_details')return{data:details(),error:null};
 if(name==='get_square_checkout_authorization_context')return{data:{scope:'independent_live_test'},error:null};
 if(name==='prepare_square_cof_checkout'){claims++;assert.equal(args._storage_consent,true);assert.equal(args._future_consent,true);assert.equal(args._terms_version,CARD_TERMS_VERSION);if(!attempt){attempt={id,period_id:null,test_id:'test',amount_cents:100,location_id:'location',environment:'live',provider_payment_id:null,created_at:new Date().toISOString(),state:'processing'};consent={id:'consent',attempt_id:id,submission_id:submission,square_customer_id:'customer',card_state:'pending',state:'pending',management_token:'f'.repeat(64),dispatch_started_at:null};}return{data:{...attempt,dispatch:!dispatch},error:null};}
 if(name==='claim_square_cof_dispatch'){if(dispatch)return{data:false,error:null};dispatch=true;consent!.dispatch_started_at='2098-01-01';return{data:true,error:null};}
 if(name==='record_square_checkout_payment'){assert.equal(args._payment_id,'square-id');attempt!.state='paid';detailsPaid=true;return{data:{},error:null};}
 if(name==='withdraw_square_checkout_authorization'){consent!.state='withdrawn';return{data:{card_id:'ccof:card'},error:null};}
 throw Error(name);
}});
const source=readFileSync('supabase/functions/renewal-checkout/index.ts','utf8').replace(/^import .*;\n/gm,'');assert.ok(!/stripe|deposit.*create/i.test(source));
const run=new Function('loadRenewalRentalAgreement','createClient','verifyRenewalPreview','SquareClient','SquareCardDeclined','assertSquareSandbox','squareSetting','squareRenewalEvidence','CARD_TERMS_VERSION','authorizationTerms','validatePayer','authorizationForAttempt','ensureSquareCustomer','finalizeCheckoutCard','Deno',stripTypeScriptTypes(source));
run(async()=>({version:"1.4",version_id:"master",master_hash:"b".repeat(64),document_hash:"c".repeat(64),booking_id:"booking",period_id:"period",source_revision_id:"revision",source_revision_hash:"d".repeat(64),rendered_text:"Complete fixture Rental Agreement",consent_text:"Explicit fixture consent"}),createClient,async()=>({}),FakeSquare,Declined,()=>{},(_:unknown,key:string)=>env['SQUARE_LIVE_'+key],squareRenewalEvidence,CARD_TERMS_VERSION,authorizationTerms,validatePayer,async()=>consent,async()=> 'customer',async()=>{consent!.state='active';consent!.card_state='verified';},{env:{get:(key:string)=>env[key]},serve:(h:typeof handler)=>handler=h});
const invoke=(body:unknown)=>handler(new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
const base={testLink:'a'.repeat(64),submissionId:submission};
assert.equal((await invoke({action:'details',...base})).status,200);assert.equal(creates,0);assert.equal(claims,0);
const pay={action:'pay',...base,token:'cnon:fixture',payer,storageConsent:true,futureConsent:true,termsVersion:CARD_TERMS_VERSION};
assert.equal((await invoke({...pay,storageConsent:false})).status,400);assert.equal(claims,0);assert.equal(creates,0);
assert.equal((await invoke({...pay,amount:1})).status,400);assert.equal(creates,0);
const paid=await invoke(pay);assert.equal(paid.status,200);const out=await paid.json();assert.equal(out.card_saved,true);assert.equal(out.future_authorization_active,true);assert.ok(!out.management_url);assert.equal(creates,1);
assert.equal((await invoke(pay)).status,409);assert.equal(creates,1);
const other=await(await invoke({action:'details',testLink:base.testLink,submissionId:'other'})).json();assert.ok(!other.management_url);assert.ok(!other.card_last4);assert.equal(other.card_saved,true);assert.equal(other.future_authorization_active,true);assert.equal(other.card_save_pending,false);assert.ok(!other.square_card_id);assert.ok(!other.square_customer_id);assert.ok(!other.setup_retry_allowed);
const reopened=await(await invoke({action:'details',testLink:base.testLink})).json();assert.equal(reopened.card_saved,true);assert.equal(reopened.future_authorization_active,true);assert.ok(!reopened.card_last4);
const revoked=await invoke({action:'withdrawAuthorization',authorizationToken:'f'.repeat(64)});assert.equal(revoked.status,410);assert.equal(consent!.state,'active');assert.equal(creates,1);
console.log('PASS: actual public checkout handler requires both affirmative consents, uses exactly $1 with no HOLD, confirms card separately, blocks duplicate payments, shows confirmed card status across browser sessions without exposing IDs, and blocks public withdrawal.');

const before=creates;detailsPaid=false;
const renewalBase={action:'pay',paymentLink:'a'.repeat(64),submissionId:submission,token:'cnon:fixture',payer,storageConsent:true,futureConsent:true,termsVersion:CARD_TERMS_VERSION};
assert.equal((await invoke(renewalBase)).status,400);
assert.equal((await invoke({...renewalBase,rentalAgreementAccepted:true,rentalAgreementHash:'wrong'})).status,400);
assert.equal(creates,before);
console.log('PASS: missing or stale renewal agreement acceptance blocks Square dispatch.');
