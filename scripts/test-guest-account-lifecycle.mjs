// Actual migrations, payment lifecycle SQL and account handler; isolated PostgreSQL.
// Auth email delivery is a simulator. No remote users, mail or processor traffic.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {handleGuestAccount} from '../supabase/functions/_shared/guest-account.ts';
const db=new PGlite({extensions:{pgcrypto}});
const guestId='eeeeeeee-0000-4000-8000-000000000001';
const email=`new-guest-${randomUUID()}@example.invalid`;
const flags={GUEST_CHECKOUT_ENABLED:'true',GUEST_ACCOUNT_INVITATIONS_ENABLED:'true',GUEST_ACCOUNT_SANDBOX_EMAIL_ENABLED:'true',GUEST_ACCOUNT_WORKER_SECRET:'synthetic-worker-secret-more-than-32-characters',APP_PUBLIC_URL:'https://fixture.invalid'};
let currentUser={id:guestId,is_anonymous:true};
let mailFail=true, confirmationFail=true, sent=0, authCalls=0;
async function rpc(name,args){
 try{
  await db.exec('SET ROLE service_role');
  const keys=Object.keys(args||{});
  const sql=`select * from public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')})`;
  const rows=(await db.query(sql,Object.values(args||{}))).rows;
  const data=['claim_guest_account_invitations','claim_guest_confirmation_emails'].includes(name)?rows:rows[0]?.[name];
  return {data,error:null};
 }catch(error){return{data:null,error};}finally{await db.exec('RESET ROLE');}
}
const client={rpc,functions:{invoke:async(name,input)=>{assert.equal(name,'send-booking-confirmation');assert.ok(input.body.bookingId);return{data:{sent:!confirmationFail},error:confirmationFail?{}:null};}},auth:{
 getUser:async()=>({data:{user:currentUser},error:null}),
 signInWithOtp:async input=>{
  authCalls++;assert.equal(input.options.shouldCreateUser,true);assert.equal(input.options.emailRedirectTo,'https://fixture.invalid/booking/access');assert.equal(input.email,email);
  assert.equal((await db.query("select trip_status from bookings where id=(select booking_id from paypal_fixture)")).rows[0].trip_status,'confirmed');
  if(mailFail)return{data:{session:null},error:{message:'synthetic mail outage'}};
  // Simulates Supabase's unique permanent email identity. No password is set.
  if(!(await db.query('select id from auth.users where lower(email)=$1 and not is_anonymous',[email])).rows.length)
   await db.query('insert into auth.users(id,email,is_anonymous) values($1,$2,false)',[randomUUID(),email]);
  sent++;return{data:{session:null},error:null};
 }}};
async function request(body,worker=false){return handleGuestAccount(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:`Bearer ${worker?flags.GUEST_ACCOUNT_WORKER_SECRET:'synthetic-user-jwt'}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),{env:k=>flags[k],client:()=>client});}
try{
 await db.exec(readFileSync('scripts/db-regression/bootstrap.sql','utf8'));
 // This fixture exercises the guest-account release and its prerequisites.
 // Later standalone-link migrations require a separate production-only baseline.
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f>='20260728140000'&&f<='20261119022948_guest_reservation_checkout.sql').sort()){
  await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
  if(f.endsWith('_zonyx_launch_baseline.sql'))await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data,created_at)
   SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=1 THEN 'zoeysnp@gmail.com' ELSE 'fixture-'||n||'@example.invalid' END,jsonb_build_object('full_name','Synthetic fixture '||n),'2026-01-01'::timestamptz+n*interval '1 day' FROM generate_series(1,6)n;
   UPDATE profiles SET is_admin=true,is_host=true WHERE email='zoeysnp@gmail.com';`);
  if(f.endsWith('_immutable_agreement_corrections_and_driver_integrity.sql'))await db.exec(readFileSync('scripts/db-regression/fixtures.sql','utf8'));
 }
 await db.exec(readFileSync('supabase/migrations/20261121203000_immediate_checkout_deposit.sql','utf8'));
 await db.query('insert into auth.users(id,is_anonymous) values($1,true)',[guestId]);
 assert.equal((await request({action:'contact',fullName:'New Guest Driver',email,phone:'+1 305 555 0123'})).status,200);
 assert.equal((await request({action:'deliver-invitations'},true)).status,200);assert.equal(authCalls,0);
 const fixture=readFileSync('supabase/tests/guest_checkout_accounts.test.sql','utf8').replaceAll("(now() AT TIME ZONE 'America/New_York')::date", "((now() AT TIME ZONE 'America/New_York')::date+120)");
 await db.exec(fixture.slice(fixture.indexOf('CREATE TEMP TABLE paypal_fixture'),fixture.indexOf('END $fixture$;')+'END $fixture$;'.length));
 const paymentSql=fixture.slice(fixture.indexOf('UPDATE paypal_fixture SET result=prepare_paypal_expanded_payment'),fixture.indexOf('CREATE TEMP TABLE claimed_jobs'))
  .split('\n').filter(line=>!line.startsWith('SELECT is(')).join('\n');
 await db.exec('SET ROLE service_role');await db.exec(paymentSql.slice(0,paymentSql.indexOf('SELECT prepare_paypal_sandbox_deposit')));
 assert.equal((await db.query('select trip_status from bookings where id=(select booking_id from paypal_fixture)')).rows[0].trip_status,'pending_payment');
 assert.equal((await db.query('select authorization_due_at from booking_security_deposits where rental_payment_id=(select payment_id from paypal_fixture)')).rows[0].authorization_due_at,null);
 await db.exec(paymentSql.slice(paymentSql.indexOf('SELECT prepare_paypal_sandbox_deposit')));
 const receipt=(await db.query('select get_provider_rental_payment_receipt(booking_id) receipt from paypal_fixture')).rows[0].receipt;
 assert.equal(receipt.bookingConfirmed,true);assert.equal(receipt.depositScheduled,false);assert.equal(receipt.depositCapturedAmountCents,0);assert.equal(receipt.depositAuthorizationId,'synthetic-hold');await db.exec('RESET ROLE');
 const snapshot=async()=> (await db.query(`select jsonb_build_array(to_jsonb(b),to_jsonb(p),to_jsonb(a)) records from bookings b join booking_payments p on p.booking_id=b.id join booking_rental_agreements a on a.booking_id=b.id where b.id=(select booking_id from paypal_fixture)`)).rows[0].records;
 const before=await snapshot();
 assert.deepEqual(await (await request({action:'deliver-invitations'},true)).json(),{sent:0,pending:1});
 assert.equal((await db.query('select trip_status from bookings where id=(select booking_id from paypal_fixture)')).rows[0].trip_status,'confirmed');
 await db.exec("UPDATE guest_checkout_private.invitations SET next_attempt_at=now()-interval '1 second'");
 mailFail=false;
 assert.deepEqual(await (await request({action:'deliver-invitations'},true)).json(),{sent:1,pending:0});
 const account=(await db.query('select * from auth.users where lower(email)=$1 and not is_anonymous',[email])).rows;
 assert.equal(account.length,1);assert.equal(account[0].email_confirmed_at,null);
 currentUser={id:account[0].id,email,is_anonymous:false};
 assert.equal((await request({action:'bookings'})).status,403);
 assert.equal((await db.query('select count(*)::int n from guest_checkout_private.account_access')).rows[0].n,0);
 // Simulates following a verified, single-use Auth email link.
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[account[0].id]);currentUser.email_confirmed_at=new Date().toISOString();
 const activation=await request({action:'bookings'});assert.equal(activation.status,200);assert.equal((await activation.json()).bookings.length,1);
 assert.equal((await request({action:'bookings'})).status,200);
 assert.equal((await db.query('select count(*)::int n from guest_checkout_private.account_access')).rows[0].n,1);
 // Redelivery to an existing email must not duplicate its permanent account.
 await db.exec("UPDATE guest_checkout_private.invitations SET sent_at=NULL,next_attempt_at=now()-interval '1 second'");
 assert.deepEqual(await (await request({action:'deliver-invitations'},true)).json(),{sent:1,pending:0});
 assert.equal((await db.query('select count(*)::int n from auth.users where lower(email)=$1 and not is_anonymous',[email])).rows[0].n,1);
 flags.GUEST_CONFIRMATION_EMAILS_ENABLED='true';
 assert.deepEqual(await (await request({action:'deliver-invitations'},true)).json(),{sent:0,pending:0,confirmationsSent:0,confirmationsPending:1});
 await db.exec("UPDATE guest_checkout_private.confirmation_jobs SET next_attempt_at=now()-interval '1 second'");confirmationFail=false;
 flags.GUEST_ACCOUNT_SANDBOX_EMAIL_ENABLED='false';
 assert.deepEqual(await (await request({action:'deliver-invitations'},true)).json(),{sent:0,pending:0,confirmationsSent:0,confirmationsPending:0});
 flags.GUEST_ACCOUNT_SANDBOX_EMAIL_ENABLED='true';
 assert.deepEqual(await (await request({action:'deliver-invitations'},true)).json(),{sent:0,pending:0,confirmationsSent:1,confirmationsPending:0});
 assert.deepEqual(await snapshot(),before);assert.equal(sent,2);
 console.log('PASS: new email → guest contact → real SQL rental capture/deposit confirmation → mail outage → retry → permanent account → blocked unverified access → verified durable booking link → duplicate-safe redelivery.');
 console.log('Auth delivery/activation and processor responses are simulated; database/payment state transitions and account handler are real local code.');
}finally{await db.close();}
