import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SquareClient } from "./square-client.ts";
import { assertSquareSandbox, assertSquareCoverage, validateSquarePayment, verifySquareSignature } from "./square-policy.ts";
const config:Record<string,string>={SQUARE_CHECKOUT_ENABLED:"true",SQUARE_PROVIDER_LOCK_READY:"true",SQUARE_ENVIRONMENT:"sandbox",SUPABASE_URL:"https://pvowzjqimikcoyjwclez.supabase.co",SQUARE_SANDBOX_PROJECT_URL:"https://pvowzjqimikcoyjwclez.supabase.co",SQUARE_SANDBOX_LOCATION_ID:"fixture-location",SQUARE_SANDBOX_ACCESS_TOKEN:"fake-sandbox-token"};
const env=(key:string)=>config[key];
assert.throws(()=>assertSquareSandbox(()=>undefined));
for(const gate of ["SQUARE_CHECKOUT_ENABLED","SQUARE_PROVIDER_LOCK_READY"]){const original=config[gate];config[gate]="false";assert.throws(()=>new SquareClient(env));config[gate]=original;}
config.SQUARE_ENVIRONMENT="live";assert.throws(()=>new SquareClient(env));config.SQUARE_ENVIRONMENT="sandbox";
const now=Date.now();assertSquareCoverage(new Date(now+166*3600000).toISOString(),now);assert.throws(()=>assertSquareCoverage(new Date(now+168*3600000).toISOString(),now));
const payment={id:"provider-id",reference_id:"reference",location_id:"fixture-location",source_type:"CARD",status:"APPROVED",amount_money:{amount:50000,currency:"USD"},delay_action:"CANCEL",delayed_until:new Date(now+168*3600000).toISOString()};
const expected={reference:"reference",location:"fixture-location",amount:50000,hold:true};
validateSquarePayment(payment,expected);
for(const change of [{status:"COMPLETED"},{reference_id:"wrong"},{delay_action:"COMPLETE"},{location_id:"wrong"},{amount_money:{amount:1,currency:"USD"}}])assert.throws(()=>validateSquarePayment({...payment,...change},expected));
const calls:Array<{url:string;body:any}>=[];
const transport=async(url:any,options:any)=>{calls.push({url:String(url),body:options.body?JSON.parse(options.body):undefined});return new Response(JSON.stringify({payment}));};
const client=new SquareClient(env,transport);
await client.create({token:"cnon:fake",key:"stable-uuid",reference:"reference",amount:50000,hold:true});
assert.equal(calls[0].body.autocomplete,false);assert.equal(calls[0].body.delay_action,"CANCEL");assert.equal(calls[0].body.idempotency_key,"stable-uuid");
await client.create({token:"cnon:other",key:"other-uuid",reference:"rental",amount:12096,hold:false});
assert.equal(calls[1].body.autocomplete,true);assert.equal(calls[1].body.delay_action,undefined);
await client.void("provider-id");assert.ok(calls[2].url.endsWith("/cancel"));
assert.ok(calls.every(c=>c.url.startsWith("https://connect.squareupsandbox.com/")));
const body='{ "event_id": "fixture" }',url="https://sandbox.invalid/webhook",key="fixture-signature";
const signature=createHmac("sha256",key).update(url+body).digest("base64");
assert.equal(await verifySquareSignature(body,signature,key,url),true);
assert.equal(await verifySquareSignature(body+" ",signature,key,url),false);
assert.equal(await verifySquareSignature(body,signature,key,url+"/"),false);
assert.equal(await verifySquareSignature(body,"invalid",key,url),false);
let posts=0;const uncertain=new SquareClient(env,async()=>{posts++;throw new Error("secret-provider-error");});
await assert.rejects(()=>uncertain.create({token:"cnon:fake",key:"stable",reference:"reference",amount:50000,hold:true}),/reconciliation/);assert.equal(posts,1);

config.SQUARE_CHECKOUT_ENABLED="false";config.SQUARE_OPERATIONS_ENABLED="true";
assert.doesNotThrow(()=>new SquareClient(env,transport,"SQUARE_OPERATIONS_ENABLED"));
assert.throws(()=>new SquareClient(env,transport));

config.SQUARE_CHECKOUT_ENABLED="true";
// Recovery follows cursor pages and obtains canonical evidence before matching.
let recoveryCalls=0;
const recovered=new SquareClient(env,async(url)=>{
 recoveryCalls++;
 const text=String(url);
 return new Response(JSON.stringify(text.includes("payments?") ?
   (text.includes("cursor=next") ? {payments:[payment]} : {payments:[],cursor:"next"}) : {payment}));
});
assert.equal((await recovered.find("reference",new Date().toISOString()))?.id,"provider-id");
assert.equal(recoveryCalls,3);
const conflict=new SquareClient(env,async()=>new Response(JSON.stringify({payments:[payment,payment]})));
await assert.rejects(()=>conflict.find("reference",new Date().toISOString()),/Conflicting/);
assert.equal(await new SquareClient(env,async()=>new Response(JSON.stringify({payments:[]}))).find("missing",new Date().toISOString()),null);
