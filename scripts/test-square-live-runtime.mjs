import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {assertSquareSandbox,verifySquareSignature} from '../supabase/functions/_shared/square-policy.ts';
import {SquareClient,SquareCardDeclined} from '../supabase/functions/_shared/square-client.ts';
const settings={SQUARE_ENVIRONMENT:'live',SUPABASE_URL:'https://fazzuetfwwfiqehpnjky.supabase.co',SQUARE_CHECKOUT_ENABLED:'true',SQUARE_PROVIDER_LOCK_READY:'true',SQUARE_LIVE_RELEASE_VERIFIED:'true',SQUARE_BUSINESS_ELIGIBILITY_VERIFIED:'true',SQUARE_LIVE_ACCESS_TOKEN:'synthetic-production-fixture',SQUARE_LIVE_LOCATION_ID:'fixture-live'};
const env=k=>settings[k];
for(const key of ['SQUARE_CHECKOUT_ENABLED','SQUARE_PROVIDER_LOCK_READY']){settings[key]='false';assert.throws(()=>new SquareClient(env),/pending/);settings[key]='true'}
settings.SQUARE_BUSINESS_ELIGIBILITY_VERIFIED='false';
settings.SQUARE_LIVE_RELEASE_VERIFIED='false';
assert.doesNotThrow(()=>new SquareClient(env)); // External classification is not an internal software activation gate.
settings.SUPABASE_URL='https://pvowzjqimikcoyjwclez.supabase.co';assert.throws(()=>assertSquareSandbox(env));settings.SUPABASE_URL='https://fazzuetfwwfiqehpnjky.supabase.co';
let requests=[];const client=new SquareClient(env,async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({payment:{id:'fixture'}}))});
await client.get('fixture');assert.equal(requests[0].url,'https://connect.squareup.com/v2/payments/fixture');assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.headers.Authorization,'Bearer synthetic-production-fixture');assert.equal('complete' in client,false);
await client.create({token:'cnon:rental',key:'rental-key',reference:'rental-ref',amount:12096,hold:false});
await client.create({token:'cnon:hold',key:'hold-key',reference:'hold-ref',amount:50000,hold:true});
assert.equal(JSON.parse(requests[1].options.body).autocomplete,true);
assert.equal(JSON.parse(requests[2].options.body).autocomplete,false);
assert.equal(JSON.parse(requests[2].options.body).delay_action,'CANCEL');
for(const [status,errors,decline] of [[400,[{category:'PAYMENT_METHOD_ERROR',code:'INSUFFICIENT_FUNDS'}],true],[500,[{category:'PAYMENT_METHOD_ERROR',code:'CARD_DECLINED'}],false],[400,[{category:'API_ERROR',code:'INTERNAL_SERVER_ERROR'}],false]]) {
 const c=new SquareClient(env,async()=>new Response(JSON.stringify({errors}),{status}));
 await assert.rejects(()=>c.create({token:'cnon:fixture',key:'key',reference:'reference',amount:1,hold:true}),error=>decline?error instanceof SquareCardDeclined:!(error instanceof SquareCardDeclined)&&error.status===502);
}
const webhookUrl='https://fazzuetfwwfiqehpnjky.supabase.co/functions/v1/square-webhook',body='{"event_id":"synthetic"}',key='synthetic-signing-key';
const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const signature=Buffer.from(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode(webhookUrl+body))).toString('base64');
assert.equal(await verifySquareSignature(body,signature,key,webhookUrl),true);assert.equal(await verifySquareSignature(body+' ',signature,key,webhookUrl),false);assert.equal(await verifySquareSignature(body,signature,key,webhookUrl.replace('fazzuetfwwfiqehpnjky','pvowzjqimikcoyjwclez')),false);
const db=new PGlite({extensions:{pgcrypto}});
try{
 await db.exec(readFileSync('scripts/db-regression/bootstrap.sql','utf8'));
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f>='20260728140000').sort()){
  await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  if(file.endsWith('_zonyx_launch_baseline.sql'))await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data,created_at) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=1 THEN 'zoeysnp@gmail.com' ELSE 'fixture-'||n||'@example.invalid' END,jsonb_build_object('full_name','Synthetic fixture '||n),'2026-01-01'::timestamptz+n*interval '1 day' FROM generate_series(1,6) n; UPDATE profiles SET is_admin=true,is_host=true WHERE email='zoeysnp@gmail.com'; UPDATE profiles SET created_at=u.created_at FROM auth.users u WHERE u.id=profiles.user_id;`);
  if(file.endsWith('_immutable_agreement_corrections_and_driver_integrity.sql'))await db.exec(readFileSync('scripts/db-regression/fixtures.sql','utf8'));
 }
 const fixtureSql=readFileSync('supabase/tests/square_checkout.test.sql','utf8').split('SET LOCAL ROLE service_role;')[0].replace('SELECT no_plan();','').replace(/'internal_test',true/g,"'internal_test',false,'rental_days',1,'daily_rate_cents',10000").replace("'minimum_rental_hours',1","'base_daily_rate_cents',10000,'minimum_rental_hours',1");
 const advanceOnly=process.argv.includes('--advance-only');
 await db.exec(advanceOnly?fixtureSql.replaceAll("(now() AT TIME ZONE 'America/New_York')::date","((now() AT TIME ZONE 'America/New_York')::date+31)"):fixtureSql);const f=(await db.query('SELECT * FROM square_fixture')).rows[0];
 await db.exec('SET ROLE service_role');
 if(advanceOnly) {
  const prepared=(await db.query('SELECT prepare_square_live_checkout($1,$2,$3) AS result',[f.booking_id,f.agreement_id,f.user_id])).rows[0].result;
  assert.equal(prepared.dispatch,true);
  await db.query("SELECT record_square_payment($1,false,'advance-rental','COMPLETED',$2,NULL)",[prepared.payment.id,prepared.payment.amount_cents]);
  await db.query('SELECT reconcile_square_booking($1)',[prepared.payment.id]);
  assert.equal((await db.query('SELECT state FROM booking_payments WHERE id=$1',[prepared.payment.id])).rows[0].state,'paid');
  assert.equal((await db.query('SELECT trip_status FROM bookings WHERE id=$1',[f.booking_id])).rows[0].trip_status,'pending_payment');
  const claimed=(await db.query('SELECT claim_square_deposit_attempt($1,$2) AS result',[prepared.payment.id,f.user_id])).rows[0].result;
  assert.equal(claimed.dispatch,true);
  console.log('PASS: advance reservation pays once and an immediate deposit hold attempt can be claimed. No external transactions.');
 } else {
 await db.exec('BEGIN; SAVEPOINT legacy_flow');
 const prepared=(await db.query('SELECT prepare_square_live_payment($1,$2,$3) AS result',[f.booking_id,f.agreement_id,f.user_id])).rows[0].result;
 assert.equal(prepared.payment.environment,'live');assert.equal(prepared.dispatch,true);
 const retry=(await db.query('SELECT prepare_square_live_payment($1,$2,$3) AS result',[f.booking_id,f.agreement_id,f.user_id])).rows[0].result;assert.equal(retry.dispatch,false);assert.equal(retry.payment.id,prepared.payment.id);
 await db.query("SELECT record_square_payment($1,true,'fixture-hold','APPROVED',$2,now()+interval '168 hours')",[prepared.payment.id,prepared.deposit.amount_cents]);
 const claim=(await db.query("SELECT claim_square_step($1,'rental',$2) AS result",[prepared.payment.id,f.user_id])).rows[0].result;assert.equal(claim.dispatch,true);
 await db.query("SELECT record_square_payment($1,false,'fixture-rental','COMPLETED',$2,NULL)",[prepared.payment.id,prepared.payment.amount_cents]);await db.query('SELECT reconcile_square_booking($1)',[prepared.payment.id]);
 assert.equal((await db.query('SELECT trip_status FROM bookings WHERE id=$1',[f.booking_id])).rows[0].trip_status,'confirmed');
 assert.equal((await db.query('SELECT captured_amount_cents FROM booking_security_deposits WHERE rental_payment_id=$1',[prepared.payment.id])).rows[0].captured_amount_cents,0);
 await db.query("SELECT claim_square_step($1,'cancel',$2,'Synthetic cancellation')",[prepared.payment.id,f.user_id]);
 assert.equal((await db.query("SELECT claim_square_step($1,'void',$2) AS result",[prepared.payment.id,f.user_id])).rows[0].result.dispatch,true);
 await db.query("SELECT record_square_payment($1,true,'fixture-hold','CANCELED',$2,NULL)",[prepared.payment.id,prepared.deposit.amount_cents]);
 const refund=(await db.query("SELECT claim_square_step($1,'refund',$2) AS result",[prepared.payment.id,f.user_id])).rows[0].result;
 assert.equal(refund.dispatch,true);assert.equal((await db.query("SELECT claim_square_step($1,'refund',$2) AS result",[prepared.payment.id,f.user_id])).rows[0].result.dispatch,false);
 await db.query("SELECT record_square_refund($1,'fixture-refund','fixture-rental',$2,'COMPLETED')",[prepared.payment.id,refund.operation.refund_amount_cents]);
 await db.query('SELECT reconcile_square_booking($1)',[prepared.payment.id]);
 assert.equal((await db.query('SELECT trip_status FROM bookings WHERE id=$1',[f.booking_id])).rows[0].trip_status,'cancelled');
 assert.ok((await db.query('SELECT released_at FROM vehicle_payment_claims WHERE payment_id=$1',[prepared.payment.id])).rows[0].released_at);
 await db.exec('ROLLBACK TO SAVEPOINT legacy_flow');
 const live=(await db.query('SELECT prepare_square_live_checkout($1,$2,$3) AS result',[f.booking_id,f.agreement_id,f.user_id])).rows[0].result;
 assert.equal(live.dispatch,true);
 assert.equal((await db.query('SELECT prepare_square_live_checkout($1,$2,$3) AS result',[f.booking_id,f.agreement_id,f.user_id])).rows[0].result.dispatch,false);
 await db.exec('SAVEPOINT unpaid_hold');
 await assert.rejects(()=>db.query('SELECT claim_square_deposit_attempt($1,$2)',[live.payment.id,f.user_id]));
 await db.exec('ROLLBACK TO SAVEPOINT unpaid_hold');
 await db.query("SELECT record_square_payment($1,false,'rental-first','COMPLETED',$2,NULL)",[live.payment.id,live.payment.amount_cents]);
 await db.query('SELECT reconcile_square_booking($1)',[live.payment.id]);
 assert.equal((await db.query('SELECT trip_status FROM bookings WHERE id=$1',[f.booking_id])).rows[0].trip_status,'pending_payment');
 assert.equal((await db.query('SELECT state FROM booking_payments WHERE id=$1',[live.payment.id])).rows[0].state,'paid');
 await db.exec('SAVEPOINT paid_without_hold');
 await db.query("SELECT claim_square_step($1,'cancel',$2,'Cancel before deposit')",[live.payment.id,f.user_id]);
 await db.query('SELECT release_square_unstarted_deposit($1)',[live.payment.id]);
 const noHoldRefund=(await db.query("SELECT claim_square_step($1,'refund',$2) AS result",[live.payment.id,f.user_id])).rows[0].result;
 assert.equal(noHoldRefund.dispatch,true);
 await db.query("SELECT record_square_refund($1,'no-hold-refund','rental-first',$2,'COMPLETED')",[live.payment.id,noHoldRefund.operation.refund_amount_cents]);
 await db.query('SELECT reconcile_square_booking($1)',[live.payment.id]);
 assert.equal((await db.query('SELECT trip_status FROM bookings WHERE id=$1',[f.booking_id])).rows[0].trip_status,'cancelled');
 await db.exec('ROLLBACK TO SAVEPOINT paid_without_hold');
 const hold1=(await db.query('SELECT claim_square_deposit_attempt($1,$2) AS result',[live.payment.id,f.user_id])).rows[0].result;
 assert.equal(hold1.dispatch,true);
 assert.equal((await db.query('SELECT claim_square_deposit_attempt($1,$2) AS result',[live.payment.id,f.user_id])).rows[0].result.dispatch,false);
 await db.exec('SAVEPOINT uncertain_hold_cancel');
 await db.query("SELECT claim_square_step($1,'cancel',$2,'Cancel unknown deposit')",[live.payment.id,f.user_id]);
 await db.query('SELECT release_square_unstarted_deposit($1)',[live.payment.id]);
 await assert.rejects(()=>db.query("SELECT claim_square_step($1,'refund',$2)",[live.payment.id,f.user_id]));
 await db.exec('ROLLBACK TO SAVEPOINT uncertain_hold_cancel');
 await db.query("SELECT record_square_deposit_attempt($1,$2,NULL,'FAILED',$3,NULL)",[live.payment.id,hold1.attempt.id,live.deposit.amount_cents]);
 await db.query('SELECT reconcile_square_booking($1)',[live.payment.id]);
 assert.equal((await db.query('SELECT state FROM booking_payments WHERE id=$1',[live.payment.id])).rows[0].state,'paid');
 const hold2=(await db.query('SELECT claim_square_deposit_attempt($1,$2) AS result',[live.payment.id,f.user_id])).rows[0].result;
 assert.equal(hold2.dispatch,true);assert.notEqual(hold2.attempt.id,hold1.attempt.id);
 await db.query("SELECT record_square_deposit_attempt($1,$2,'verified-hold','APPROVED',$3,now()+interval '168 hours')",[live.payment.id,hold2.attempt.id,live.deposit.amount_cents]);
 await db.query("SELECT record_square_deposit_attempt($1,$2,NULL,'FAILED',$3,NULL)",[live.payment.id,hold1.attempt.id,live.deposit.amount_cents]);
 await db.query('SELECT reconcile_square_booking($1)',[live.payment.id]);
 assert.equal((await db.query('SELECT trip_status FROM bookings WHERE id=$1',[f.booking_id])).rows[0].trip_status,'confirmed');
 assert.equal((await db.query('SELECT capture_id FROM booking_payments WHERE id=$1',[live.payment.id])).rows[0].capture_id,'rental-first');
 assert.equal((await db.query('SELECT captured_amount_cents FROM booking_security_deposits WHERE rental_payment_id=$1',[live.payment.id])).rows[0].captured_amount_cents,0);
 await db.exec('COMMIT; RESET ROLE; SET ROLE authenticated');await assert.rejects(()=>db.query('SELECT prepare_square_live_payment($1,$2,$3)',[f.booking_id,f.agreement_id,f.user_id]));
 await assert.rejects(()=>db.query('SELECT prepare_square_live_checkout($1,$2,$3)',[f.booking_id,f.agreement_id,f.user_id]));
 console.log('PASS: live release gates, project isolation, production GET routing, signed webhook URL/body integrity, customer terms, provider lock, idempotency, canonical confirmation, void/refund recovery and zero deposit capture. Synthetic local SQL only; no external payments.');
 }
}finally{await db.close()}
