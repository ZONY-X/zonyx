import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {squareRenewalEvidence} from './square-renewal.ts';
let handler:(r:Request)=>Promise<Response>;let recorded=0,originalOperations=0;
const a={id:'11111111-1111-4111-8111-111111111111',period_id:'period',amount_cents:158400,location_id:'location',environment:'live',provider_payment_id:null,created_at:new Date().toISOString(),state:'processing'};
const p={id:'square-payment',reference_id:a.id,location_id:'location',status:'COMPLETED',source_type:'CARD',amount_money:{amount:158400,currency:'USD'}};
const db={from:(table:string)=>{let q:Record<string,unknown>;q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='square_renewal_payment_attempts'?a:null,error:null})};return q;}};
class FakeSquare{async get(){return p;}}
const source=readFileSync('supabase/functions/square-webhook/index.ts','utf8').replace(/^import .*;\n/gm,'');
const run=new Function('serve','env','json','paymentFailure','rpc','serviceClient','PaymentError','assertSquareSandbox','squareSetting','verifySquareSignature','SquareClient','squareRecord','squareRenewalEvidence',stripTypeScriptTypes(source));
run((h:typeof handler)=>handler=h,()=> 'live',(status:number,body:unknown)=>Response.json(body,{status}),(e:Error)=>Response.json({error:e.message},{status:500}),async(_:unknown,name:string,args:Record<string,unknown>)=>{assert.equal(name,'record_square_renewal_payment');assert.equal(args._payment_id,p.id);recorded++;},()=>db,Error,()=>{},(_:unknown,name:string)=>name==='MERCHANT_ID'?'merchant':'fixture',async()=>true,FakeSquare,async()=>{originalOperations++;},squareRenewalEvidence);
const result=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({merchant_id:'merchant',event_id:'event',type:'payment.updated',data:{object:{payment:{id:p.id}}}})}));
assert.equal(result.status,200);assert.equal(recorded,1);assert.equal(originalOperations,0);
console.log('PASS: signed Square renewal webhook settles canonical renewal only, with no original rental or deposit operations.');
