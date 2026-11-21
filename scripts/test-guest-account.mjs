// Actual account handler with injected Auth/SQL boundaries. No network/emails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleGuestAccount } from '../supabase/functions/_shared/guest-account.ts';
import { parseGuestContact } from '../src/lib/guestCheckoutPolicy.ts';
const id='eeeeeeee-0000-4000-8000-000000000001';
const secret='synthetic-worker-secret-at-least-32-characters';
function fixture(options={}) {
 const calls=[],emails=[];
 const flags={GUEST_CHECKOUT_ENABLED:'true',GUEST_ACCOUNT_INVITATIONS_ENABLED:'true',GUEST_ACCOUNT_WORKER_SECRET:secret,APP_PUBLIC_URL:'https://fixture.invalid',...options.flags};
 const auth={getUser:async()=>({data:{user:options.invalidJwt?null:{id,is_anonymous:options.anonymous!==false,email:'customer@example.invalid',email_confirmed_at:options.verified?'2026-01-01':null}},error:options.invalidJwt?{}:null}),
 signInWithOtp:async input=>{emails.push(input);return{data:{session:null,user:null},error:options.emailFailure?{}:null}}};
 const db={auth,rpc:async(name,args)=>{calls.push({name,args});if(options.finishThrows&&name==='finish_guest_account_invitation')throw new Error('synthetic RPC transport failure');return{data:name==='claim_guest_account_invitations'?(options.noJobs?[]:[{booking_id:id,email:'customer@example.invalid',lease_id:id}]):name==='get_guest_checkout_account_status'?{confirmed:false,invitationSent:false}:name==='get_verified_guest_account_bookings'?[]:null,error:options.sqlFailure?{}:null}}};
 return{calls,emails,async request(body,token='synthetic-user-jwt'){return handleGuestAccount(new Request('https://fixture.invalid/functions/v1/guest-account',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),{env:k=>flags[k],client:()=>db})}};
}
let count=0;
async function check(name,run){await run();count++;console.log('PASS: '+name)}
await check('OFF rejects before SQL or Auth sends',async()=>{const f=fixture({flags:{GUEST_CHECKOUT_ENABLED:'false'}});assert.equal((await f.request({action:'contact'})).status,403);assert.equal(f.calls.length,0);assert.equal(f.emails.length,0)});
await check('Entered email normalized but never signs the guest into that account',async()=>{const f=fixture();const r=await f.request({action:'contact',fullName:'Guest Driver',email:' Customer@Example.Invalid ',phone:'+1 305 555 0123'});assert.equal(r.status,200);assert.equal(f.calls[0].args._email,'customer@example.invalid');assert.equal(f.calls[0].args._user_id,id);assert.equal(f.emails.length,0);assert.doesNotMatch(await r.text(),/token|customer@example/)});
await check('Injected owner/account fields rejected',async()=>{const f=fixture();assert.equal((await f.request({action:'contact',fullName:'Guest Driver',email:'customer@example.invalid',phone:'+1 305 555 0123',userId:'other'})).status,400);assert.equal(f.calls.length,0)});
await check('Invalid JWT cannot register or access',async()=>{const f=fixture({invalidJwt:true});assert.equal((await f.request({action:'status',bookingId:id})).status,401);assert.equal(f.calls.length,0)});
await check('Anonymous and unverified permanent accounts cannot activate',async()=>{for(const options of [{verified:true},{anonymous:false,verified:false}]){const f=fixture(options);assert.equal((await f.request({action:'bookings'})).status,403);assert.equal(f.calls.length,0)}});
await check('Verified existing account uses server identity rather than request email',async()=>{const f=fixture({anonymous:false,verified:true});assert.equal((await f.request({action:'bookings'})).status,200);assert.equal(f.calls[0].name,'get_verified_guest_account_bookings');assert.deepEqual(f.calls[0].args,{_user_id:id});assert.equal(f.emails.length,0)});
await check('Status is read-only and cannot manufacture confirmation',async()=>{const f=fixture();const r=await f.request({action:'status',bookingId:id});assert.deepEqual(await r.json(),{confirmed:false,invitationSent:false});assert.deepEqual(f.calls.map(c=>c.name),['get_guest_checkout_account_status']);assert.equal(f.emails.length,0)});
await check('User JWT cannot invoke invitation worker',async()=>{const f=fixture();assert.equal((await f.request({action:'deliver-invitations'})).status,403);assert.equal(f.calls.length,0)});
await check('Worker invitation gate OFF sends no email',async()=>{const f=fixture({flags:{GUEST_ACCOUNT_INVITATIONS_ENABLED:'false'}});assert.equal((await f.request({action:'deliver-invitations'},secret)).status,403);assert.equal(f.calls.length,0)});
await check('Unconfirmed/failed payment produces no account email',async()=>{const f=fixture({noJobs:true});assert.equal((await f.request({action:'deliver-invitations'},secret)).status,200);assert.equal(f.emails.length,0)});
await check('Confirmed job requests secure access using existing Auth; no session returned',async()=>{const f=fixture();const r=await f.request({action:'deliver-invitations'},secret);assert.deepEqual(await r.json(),{sent:1,pending:0});assert.deepEqual(f.emails,[{email:'customer@example.invalid',options:{shouldCreateUser:true,emailRedirectTo:'https://fixture.invalid/booking/access'}}]);assert.equal(f.calls[0].args._sandbox,false);assert.equal(f.calls[1].args._sent,true);assert.doesNotMatch(JSON.stringify(f.calls),/capture|authorization|finalize|booking.*update/)});
await check('Email failure only releases mail lease for retry',async()=>{const f=fixture({emailFailure:true});const r=await f.request({action:'deliver-invitations'},secret);assert.deepEqual(await r.json(),{sent:0,pending:1});assert.deepEqual(f.calls.map(c=>c.name),['claim_guest_account_invitations','finish_guest_account_invitation']);assert.equal(f.calls[1].args._sent,false)});
await check('SQL failure cannot trigger an email or financial retry',async()=>{const f=fixture({sqlFailure:true});assert.equal((await f.request({action:'deliver-invitations'},secret)).status,503);assert.equal(f.emails.length,0)});
await check('Worker transport failure is reported as server error for scheduler monitoring',async()=>{const f=fixture({finishThrows:true});assert.equal((await f.request({action:'deliver-invitations'},secret)).status,500);assert.deepEqual(f.calls.map(c=>c.name),['claim_guest_account_invitations','finish_guest_account_invitation'])});
await check('Contact validation rejects headers and malformed data',async()=>{for(const input of [{fullName:'Guest\nBcc: x',email:'customer@example.invalid',phone:'+1 305 555 0123'},{fullName:'Guest Driver',email:'bad@x',phone:'+1 305 555 0123'},{fullName:'Guest Driver',email:'customer@example.invalid',phone:'bad'}])assert.throws(()=>parseGuestContact(input))});
await check('Guest or unverified user cannot approve handover',async()=>{for(const options of [{verified:true},{anonymous:false}]){const f=fixture(options);assert.equal((await f.request({action:'verify-handover',bookingId:id,identityChecked:true,licenseChecked:true})).status,403);assert.equal(f.calls.length,0)}});
await check('Both staff document checks are required',async()=>{const f=fixture({anonymous:false,verified:true});assert.equal((await f.request({action:'verify-handover',bookingId:id,identityChecked:true,licenseChecked:false})).status,400);assert.equal(f.calls.length,0)});
await check('Staff approval is scoped to server actor and checked again by SQL',async()=>{const f=fixture({anonymous:false,verified:true});assert.equal((await f.request({action:'verify-handover',bookingId:id,identityChecked:true,licenseChecked:true})).status,200);assert.deepEqual(f.calls,[{name:'guest_checkout_handover',args:{_actor_user_id:id,_booking_id:id,_approve:true}}])});

await check('Intake OFF preserves authorized reservation services and invitation retries',async()=>{
 for(const intake of ['false',undefined]) {
  const flags={GUEST_CHECKOUT_ENABLED:intake};
  for(const action of ['bookings','handover-status','verify-handover']) {
   const f=fixture({flags,anonymous:false,verified:true});
   assert.equal((await f.request({action,...(action==='bookings'?{}:{bookingId:id,identityChecked:true,licenseChecked:true})})).status,200);
   assert.equal(f.calls.length,1);
  }
  const status=fixture({flags});assert.equal((await status.request({action:'status',bookingId:id})).status,200);
  const worker=fixture({flags});assert.equal((await worker.request({action:'deliver-invitations'},secret)).status,200);assert.equal(worker.emails.length,1);
  const retry=fixture({flags,emailFailure:true});assert.deepEqual(await (await retry.request({action:'deliver-invitations'},secret)).json(),{sent:0,pending:1});
 }
});
await check('Intake OFF preserves authorization and independent invitation gate',async()=>{
 const flags={GUEST_CHECKOUT_ENABLED:'false'};
 for(const options of [{invalidJwt:true},{verified:true},{anonymous:false}]) {
  const f=fixture({...options,flags});assert.ok([401,403].includes((await f.request({action:'bookings'})).status));assert.equal(f.calls.length,0);
 }
 const f=fixture({flags:{...flags,GUEST_ACCOUNT_INVITATIONS_ENABLED:'false'}});assert.equal((await f.request({action:'deliver-invitations'},secret)).status,403);assert.equal(f.emails.length,0);
 const wrong=fixture({flags});assert.equal((await wrong.request({action:'deliver-invitations'})).status,403);assert.equal(wrong.calls.length,0);
});
await check('Scheduler template uses bounded, secret-backed one-minute delivery',async()=>{
 const sql=readFileSync('supabase/ops/guest-account-scheduler.sql','utf8');
 assert.match(sql,/cron\.schedule\('zonyx-guest-account-invitations', '\* \* \* \* \*'/);
 assert.match(sql,/\{"action":"deliver-invitations"\}/);
 for(const name of ['guest_account_worker_url','guest_account_worker_secret','guest_account_publishable_key'])assert.match(sql,new RegExp(name));
 const timeout=Number(sql.match(/timeout_milliseconds\s*:=\s*(\d+)/)?.[1]);
 assert.ok(timeout>0&&timeout<60000,'HTTP timeout must be shorter than the one-minute cron interval');
 assert.match(sql,/cron\.job_run_details/);
 assert.match(sql,/net\._http_response/);
 assert.match(sql,/attempts>=8/);
});


await check('Exact Sandbox local browser origin is allowed without widening production CORS',async()=>{
 for(const project of ['https://pvowzjqimikcoyjwclez.supabase.co','https://fazzuetfwwfiqehpnjky.supabase.co']){
  const r=await handleGuestAccount(new Request('https://fixture.invalid',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:4175'}}),{env:k=>({SUPABASE_URL:project,APP_PUBLIC_URL:'https://fixture.invalid'}[k]),client:()=>{throw Error('No client needed for preflight')}});
  assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),project.includes('pvowz')?'http://127.0.0.1:4175':'https://fixture.invalid');
 }
});

console.log(`${count} offline guest account checks passed; no real emails, Auth users, or financial transactions.`);
