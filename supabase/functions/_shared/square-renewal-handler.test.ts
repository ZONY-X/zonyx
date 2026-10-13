import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {squareRenewalEvidence} from './square-renewal.ts';
let handler:(r:Request)=>Promise<Response>;let admin=true,creates=0,claims=0,records=0,dispatch=true;
const attempt={id:'attempt',period_id:'period',amount_cents:158400,location_id:'location',environment:'live',provider_payment_id:'square-id',created_at:new Date().toISOString(),state:'processing'};
const payment={id:'square-id',reference_id:'attempt',location_id:'location',status:'COMPLETED',source_type:'CARD',amount_money:{amount:158400,currency:'USD'}};
const env:Record<string,string>={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',SQUARE_ENVIRONMENT:'live',SQUARE_LIVE_APPLICATION_ID:'sq0idp-fixture'};
class FakeSquare{location='location';async create(input:{amount:number;hold:boolean;key:string;reference:string}){creates++;assert.equal(input.amount,158400);assert.equal(input.hold,false);assert.equal(input.key,'attempt');assert.equal(input.reference,'attempt');return payment;}async get(){return payment;}async find(){return payment;}}
class Declined extends Error{}
const createClient=()=>({auth:{getUser:async()=>({data:{user:{id:admin?'admin':'guest'}},error:null})},rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='get_guest_renewal_details')return{data:{can_pay:!admin,admin_inspection:admin,amount_cents:158400},error:null};if(name==='prepare_square_renewal_payment'){claims++;assert.equal(args._user_id,'guest');return{data:{...attempt,dispatch},error:null};}if(name==='record_square_renewal_payment'){records++;assert.equal(args._payment_id,'square-id');return{data:{},error:null};}throw Error(name);}});
const code=readFileSync('supabase/functions/renewal-checkout/index.ts','utf8').replace(/^import .*;\n/gm,'');
assert.ok(!/stripe|checkout\.sessions|prepare_guest_renewal_checkout/i.test(code));
const run=new Function('createClient','verifyRenewalPreview','SquareClient','SquareCardDeclined','assertSquareSandbox','squareSetting','squareRenewalEvidence','Deno',stripTypeScriptTypes(code));
run(createClient,async()=>({}),FakeSquare,Declined,()=>{},(_:unknown,suffix:string)=>env['SQUARE_LIVE_'+suffix],squareRenewalEvidence,{env:{get:(k:string)=>env[k]},serve:(h:typeof handler)=>handler=h});
const invoke=(body:unknown)=>handler(new Request('https://fixture.invalid',{method:'POST',headers:{authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)}));
assert.equal((await invoke({action:'details',periodId:'period'})).status,200);assert.equal(creates,0);assert.equal(claims,0);
assert.equal((await invoke({action:'pay',periodId:'period',token:'cnon:fixture'})).status,403);assert.equal(claims,0);assert.equal(creates,0);
assert.equal((await invoke({action:'pay',previewToken:'fixture'})).status,403);
admin=false;assert.equal((await invoke({action:'pay',periodId:'period'})).status,400);assert.equal(claims,0);
assert.equal((await invoke({action:'pay',periodId:'period',token:'cnon:fixture',amount:1})).status,400);
assert.equal((await invoke({action:'pay',periodId:'period',token:'cnon:fixture'})).status,200);assert.equal(creates,1);assert.equal(records,1);
dispatch=false;assert.equal((await invoke({action:'pay',periodId:'period',token:'cnon:fixture'})).status,200);assert.equal(creates,1);assert.equal(records,2);
console.log('PASS: actual handler uses Square only; admin inspection has zero claims/posts; server-owned renewal-only amount, canonical settlement, and duplicate dispatch blocked.');
