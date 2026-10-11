import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {assertSquareSandbox} from '../supabase/functions/_shared/square-policy.ts';
import {SquareClient} from '../supabase/functions/_shared/square-client.ts';
const settings={SQUARE_ENVIRONMENT:'live',SUPABASE_URL:'https://fazzuetfwwfiqehpnjky.supabase.co',SQUARE_CHECKOUT_ENABLED:'true',SQUARE_PROVIDER_LOCK_READY:'true',SQUARE_LIVE_RELEASE_VERIFIED:'true',SQUARE_BUSINESS_ELIGIBILITY_VERIFIED:'true',SQUARE_LIVE_ACCESS_TOKEN:'synthetic-production-fixture',SQUARE_LIVE_LOCATION_ID:'fixture-live'};
const env=k=>settings[k];
for(const key of ['SQUARE_CHECKOUT_ENABLED','SQUARE_PROVIDER_LOCK_READY','SQUARE_LIVE_RELEASE_VERIFIED','SQUARE_BUSINESS_ELIGIBILITY_VERIFIED']){settings[key]='false';assert.throws(()=>new SquareClient(env),/pending|approval/);settings[key]='true'}
settings.SUPABASE_URL='https://pvowzjqimikcoyjwclez.supabase.co';assert.throws(()=>assertSquareSandbox(env));settings.SUPABASE_URL='https://fazzuetfwwfiqehpnjky.supabase.co';
let requests=[];const client=new SquareClient(env,async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({payment:{id:'fixture'}}))});
await client.get('fixture');assert.equal(requests[0].url,'https://connect.squareup.com/v2/payments/fixture');assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.headers.Authorization,'Bearer synthetic-production-fixture');assert.equal('complete' in client,false);
const db=new PGlite({extensions:{pgcrypto}});
try{
 await db.exec(readFileSync('scripts/db-regression/bootstrap.sql','utf8'));
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f>='20260728140000').sort()){
  await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  if(file.endsWith('_zonyx_launch_baseline.sql'))await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data,created_at) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=1 THEN 'zoeysnp@gmail.com' ELSE 'fixture-'||n||'@example.invalid' END,jsonb_build_object('full_name','Synthetic fixture '||n),'2026-01-01'::timestamptz+n*interval '1 day' FROM generate_series(1,6) n; UPDATE profiles SET is_admin=true,is_host=true WHERE email='zoeysnp@gmail.com'; UPDATE profiles SET created_at=u.created_at FROM auth.users u WHERE u.id=profiles.user_id;`);
  if(file.endsWith('_immutable_agreement_corrections_and_driver_integrity.sql'))await db.exec(readFileSync('scripts/db-regression/fixtures.sql','utf8'));
 }
 const fixtureSql=readFileSync('supabase/tests/square_checkout.test.sql','utf8').split('SET LOCAL ROLE service_role;')[0].replace('SELECT no_plan();','').replace(/'internal_test',true/g,"'internal_test',false,'rental_days',1,'daily_rate_cents',10000").replace("'minimum_rental_hours',1","'base_daily_rate_cents',10000,'minimum_rental_hours',1");
 await db.exec(fixtureSql);const f=(await db.query('SELECT * FROM square_fixture')).rows[0];
 await db.exec('SET ROLE service_role');
 const prepared=(await db.query('SELECT prepare_square_live_payment($1,$2,$3) AS result',[f.booking_id,f.agreement_id,f.user_id])).rows[0].result;
 assert.equal(prepared.payment.environment,'live');assert.equal(prepared.dispatch,true);
 const retry=(await db.query('SELECT prepare_square_live_payment($1,$2,$3) AS result',[f.booking_id,f.agreement_id,f.user_id])).rows[0].result;assert.equal(retry.dispatch,false);assert.equal(retry.payment.id,prepared.payment.id);
 await db.query("SELECT record_square_payment($1,true,'fixture-hold','APPROVED',$2,now()+interval '168 hours')",[prepared.payment.id,prepared.deposit.amount_cents]);
 const claim=(await db.query("SELECT claim_square_step($1,'rental',$2) AS result",[prepared.payment.id,f.user_id])).rows[0].result;assert.equal(claim.dispatch,true);
 await db.query("SELECT record_square_payment($1,false,'fixture-rental','COMPLETED',$2,NULL)",[prepared.payment.id,prepared.payment.amount_cents]);await db.query('SELECT reconcile_square_booking($1)',[prepared.payment.id]);
 assert.equal((await db.query('SELECT trip_status FROM bookings WHERE id=$1',[f.booking_id])).rows[0].trip_status,'confirmed');
 assert.equal((await db.query('SELECT captured_amount_cents FROM booking_security_deposits WHERE rental_payment_id=$1',[prepared.payment.id])).rows[0].captured_amount_cents,0);
 await db.exec('RESET ROLE; SET ROLE authenticated');await assert.rejects(()=>db.query('SELECT prepare_square_live_payment($1,$2,$3)',[f.booking_id,f.agreement_id,f.user_id]));
 console.log('PASS: live release gates, project isolation, production GET routing, customer terms, provider lock, idempotency, canonical confirmation and zero deposit capture. Synthetic local SQL only; no external payments.');
}finally{await db.close()}
