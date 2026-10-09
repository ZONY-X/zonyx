import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { trustedPayPalDiagnosticCertificate, verifyPayPalDiagnosticSignature } from '../supabase/functions/sandbox-payment-diagnostics/signature.ts';
import { X509Certificate, createHmac } from 'node:crypto';
import { verifySandboxStripeSignature } from '../supabase/functions/stripe-checkout-sandbox/webhook-policy.ts';
const uid='52af03eb-1976-4db0-900a-6509b1c8405b';
function setup({gate=false,user=uid}={}) {
 let handler;const calls=[];
 const env=name=>{calls.push('env:'+name);return {SUPABASE_URL:'https://pvowzjqimikcoyjwclez.supabase.co',PAYPAL_PROVIDER_LOCK_READY:String(gate),PAYPAL_SANDBOX_CLIENT_ID:'synthetic-id',PAYPAL_SANDBOX_CLIENT_SECRET:'synthetic-secret',PAYPAL_WEBHOOK_ID:'synthetic-webhook',STRIPE_SANDBOX_WEBHOOK_SECRET:'synthetic-signing'}[name]};
 class PayPalClient{async browserClientToken(){calls.push('sdk-token');return 'synthetic-browser-token'}async verifyWebhook(){calls.push('verify-postback');return true}}
 const context={X509Certificate,trustedPayPalDiagnosticCertificate,verifyPayPalDiagnosticSignature,Request,Response,Headers,URL,JSON,Boolean,Object,AbortSignal,btoa,Deno:{env:{get:env}},PayPalClient,verifySandboxStripeSignature,serve:h=>handler=h,createClient:()=>({auth:{getUser:async()=>({data:{user:{id:user}}})},from:()=>({select(){return this},eq(){return this},single:async()=>({data:{is_internal_tester:true,is_admin:false}})}),rpc:async()=>({data:[{status:'eligible_self_attested'}]})}),fetch:async url=>{assert.ok(String(url)==='https://api-m.sandbox.paypal.com/v1/oauth2/token'||String(url)==='https://api-m.sandbox.paypal.com/v1/notifications/webhooks/synthetic-webhook');calls.push('provider:'+url);return new Response(JSON.stringify(String(url).endsWith('/token')?{access_token:'synthetic-privileged-token'}:{id:'synthetic-webhook',url:'https://pvowzjqimikcoyjwclez.supabase.co/functions/v1/paypal-webhook',event_types:[{name:'*'}]}))}};
 const code=ts.transpileModule(readFileSync('supabase/functions/sandbox-payment-diagnostics/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'');vm.runInNewContext(code,context);
 return {calls,post:(body,headers={authorization:'Bearer synthetic'})=>handler(new Request('https://sandbox.invalid',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)}))};
}
const off=setup({gate:true});assert.equal((await off.post({action:'check'})).status,503);assert.ok(!off.calls.some(x=>/CLIENT_SECRET|sdk-token|provider:/.test(x)));
const wrong=setup({user:'wrong'});assert.equal((await wrong.post({action:'check'})).status,403);assert.ok(!wrong.calls.includes('sdk-token'));
const invalid=setup();assert.equal((await invalid.post({action:'capture'})).status,400);assert.ok(!invalid.calls.includes('sdk-token'));
const good=setup();const result=await (await good.post({action:'check'})).json();assert.equal(result.sdkTokenEligible,true);assert.equal(result.driverEligible,true);assert.ok(!JSON.stringify(result).includes('synthetic-'));assert.ok(!Object.keys(result).some(x=>/secret|access_token|clientToken/i.test(x)));
const body=JSON.stringify({livemode:false,id:'synthetic-event'}),time=Math.floor(Date.now()/1000),sig=createHmac('sha256','synthetic-signing').update(`${time}.${body}`).digest('hex');const signed=setup();assert.equal((await signed.post(body,{'stripe-signature':`t=${time},v1=${sig}`})).status,200);assert.ok(!signed.calls.some(x=>x.startsWith('provider:')||x==='sdk-token'));
console.log('5 non-financial diagnostic scenarios passed; secrets never returned, financial actions rejected.');
