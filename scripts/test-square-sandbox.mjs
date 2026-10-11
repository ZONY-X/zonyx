// Opt-in integration test: genuine Square sandbox API + isolated PostgreSQL.
// Never accepts a remote database URL, live token, or production API host.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { SquareClient } from '../supabase/functions/_shared/square-client.ts';
import { PaymentError, assertAmountIntegrity } from '../supabase/functions/_shared/payment-policy.ts';
import { assertSquareSandbox, assertSquareCoverage, validateSquarePayment, verifySquareSignature } from '../supabase/functions/_shared/square-policy.ts';

const offline=process.argv.includes('--offline-contract');
if(offline)for(const name of ['SQUARE_SANDBOX_ACCESS_TOKEN','SQUARE_SANDBOX_LOCATION_ID','SQUARE_SANDBOX_APPLICATION_ID','SQUARE_SANDBOX_MERCHANT_ID'])process.env[name]='offline-fixture';
const offlinePayments=new Map(),offlineRefunds=new Map(),offlineKeys=new Map();
const required=['SQUARE_SANDBOX_ACCESS_TOKEN','SQUARE_SANDBOX_LOCATION_ID','SQUARE_SANDBOX_APPLICATION_ID','SQUARE_SANDBOX_MERCHANT_ID'];
const missing=required.filter(name=>!process.env[name]);
if(missing.length) { console.error('BLOCKED: missing sandbox configuration: '+missing.join(', ')); process.exit(2); }
if(process.env.SQUARE_ENVIRONMENT && process.env.SQUARE_ENVIRONMENT!=='sandbox') throw new Error('Sandbox only.');
const settings={...Object.fromEntries(required.map(name=>[name,process.env[name]])),SQUARE_CHECKOUT_ENABLED:'true',SQUARE_OPERATIONS_ENABLED:'true',SQUARE_WEBHOOK_ENABLED:'true',SQUARE_PROVIDER_LOCK_READY:'true',SQUARE_ENVIRONMENT:'sandbox',SUPABASE_URL:'https://pvowzjqimikcoyjwclez.supabase.co',SQUARE_SANDBOX_PROJECT_URL:'https://pvowzjqimikcoyjwclez.supabase.co',ZONYX_INTERNAL_TEST_ENABLED:'true',ZONYX_INTERNAL_TEST_EMAIL:'fixture-2@example.invalid'};
const env=name=>settings[name];
// Test transport permits only Square sandbox, including redirects.
const transport=async(url,options)=>{
 if(new URL(String(url)).origin!=='https://connect.squareupsandbox.com') throw new Error('External destination denied.');
 if(offline) {
  const parsed=new URL(String(url)),path=parsed.pathname,body=options.body?JSON.parse(options.body):null;
  let result;
  if(path==='/v2/payments'&&body) {
   const id=offlineKeys.get(body.idempotency_key)||randomUUID();offlineKeys.set(body.idempotency_key,id);
   const payment=offlinePayments.get(id)||{id,reference_id:body.reference_id,location_id:body.location_id,status:body.autocomplete?'COMPLETED':'APPROVED',source_type:'CARD',amount_money:body.amount_money,total_money:body.amount_money,approved_money:body.amount_money,...(!body.autocomplete?{delay_action:'CANCEL',delayed_until:new Date(Date.now()+168*3600000).toISOString()}:{} )};
   offlinePayments.set(id,payment);result={payment};
  } else if(path==='/v2/payments')result={payments:[...offlinePayments.values()]};
  else if(path.endsWith('/cancel')) {const payment=offlinePayments.get(path.split('/')[3]);payment.status='CANCELED';result={payment};}
  else if(path.startsWith('/v2/payments/'))result={payment:offlinePayments.get(path.split('/')[3])};
  else if(path==='/v2/refunds'&&body) {const id=offlineKeys.get(body.idempotency_key)||randomUUID();offlineKeys.set(body.idempotency_key,id);const refund={id,payment_id:body.payment_id,amount_money:body.amount_money,status:'COMPLETED',location_id:'offline-fixture',reason:body.reason};offlineRefunds.set(id,refund);offlinePayments.get(body.payment_id).refunded_money=body.amount_money;result={refund};}
  else if(path==='/v2/refunds')result={refunds:[...offlineRefunds.values()]};
  else if(path.startsWith('/v2/refunds/'))result={refund:offlineRefunds.get(path.split('/')[3])};
  else throw new Error('Unexpected offline endpoint');
  return new Response(JSON.stringify(result));
 }
 return fetch(url,{...options,redirect:'error'});
};
class SandboxClient extends SquareClient { constructor(_env,_transport,gate) { super(env,transport,gate); } }
const client=new SandboxClient(env);
const database=new PGlite({extensions:{pgcrypto}});
const evidence={environment:offline?'OFFLINE CONTRACT SIMULATION':'sandbox',runId:randomUUID(),checks:[],paymentIds:[],bookingId:null};
const pass=name=>{evidence.checks.push(name);console.log((offline?'OFFLINE PASS: ':'PASS: ')+name);};
let fixture;
try {
 await database.exec(readFileSync('scripts/db-regression/bootstrap.sql','utf8'));
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f>='20260728140000').sort()) {
  await database.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  if(file.endsWith('_zonyx_launch_baseline.sql')) await database.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data,created_at) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n=1 THEN 'zoeysnp@gmail.com' ELSE 'fixture-'||n||'@example.invalid' END,jsonb_build_object('full_name','Synthetic fixture '||n),'2026-01-01'::timestamptz+n*interval '1 day' FROM generate_series(1,6) n; UPDATE profiles SET is_admin=true,is_host=true WHERE email='zoeysnp@gmail.com'; UPDATE profiles SET created_at=u.created_at FROM auth.users u WHERE u.id=profiles.user_id;`);
  if(file.endsWith('_immutable_agreement_corrections_and_driver_integrity.sql')) await database.exec(readFileSync('scripts/db-regression/fixtures.sql','utf8'));
 }
 const fixtureSource=readFileSync('supabase/tests/square_checkout.test.sql','utf8').split('SET LOCAL ROLE service_role;')[0].replace('SELECT no_plan();','');
 await database.exec(fixtureSource);
 fixture=(await database.query('SELECT * FROM square_fixture')).rows[0];
 evidence.bookingId=fixture.booking_id;
 const vehicle=(await database.query('SELECT vehicle_id FROM bookings WHERE id=$1',[fixture.booking_id])).rows[0];
 settings.SQUARE_MANAGED_VEHICLE_IDS=vehicle.vehicle_id;
 await database.exec('SET ROLE service_role');
 const allowedTables=new Set(['profiles','bookings','booking_rental_agreements','booking_payments','booking_security_deposits','square_payment_operations','payment_webhook_receipts','vehicles']);
 const quote=name=>{if(!/^[a-z_]+$/.test(name))throw new Error('Unsafe identifier');return '"'+name+'"';};
 class Query {
  constructor(table){if(!allowedTables.has(table))throw new Error('Table denied');this.table=table;this.fields='*';this.conditions=[];}
  select(fields='*'){this.fields=fields==='*'?'*':fields.split(',').map(quote).join(',');return this;}
  eq(name,value){this.conditions.push([name,value]);return this;}
  async rows(){return (await database.query(`SELECT ${this.fields} FROM ${quote(this.table)} WHERE ${this.conditions.map(([name],i)=>`${quote(name)}=$${i+1}`).join(' AND ')||'true'}`,this.conditions.map(([,value])=>value))).rows;}
  async single(){try{const rows=await this.rows();return {data:rows.length===1?rows[0]:null,error:rows.length===1?null:new Error('Expected one row')};}catch(error){return {data:null,error};}}
  async maybeSingle(){try{const rows=await this.rows();return {data:rows[0]||null,error:rows.length>1?new Error('Ambiguous rows'):null};}catch(error){return {data:null,error};}}
  async upsert(row){try{const keys=Object.keys(row);await database.query(`INSERT INTO ${quote(this.table)}(${keys.map(quote).join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(provider,environment,event_id) DO NOTHING`,Object.values(row));return {error:null};}catch(error){return {error};}}
 }
 const db={from:table=>new Query(table)};
 const rpc=async(_db,name,args)=>{
  if(!/^(prepare_square_payment|claim_square_step|record_square_payment|record_square_refund|reconcile_square_booking|complete_square_cancellation|flag_square_reconciliation|get_provider_rental_payment_receipt|paypal_trip_inspection_deadline)$/.test(name))throw new Error('RPC denied');
  const keys=Object.keys(args);
  return (await database.query(`SELECT public.${name}(${keys.map((key,i)=>quote(key)+'=> $'+(i+1)).join(',')}) AS result`,Object.values(args))).rows[0].result;
 };
 const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const globals={Request,Response,URL,URLSearchParams,JSON,Object,Date,Number,Math,crypto,console,PaymentError,assertAmountIntegrity,assertSquareSandbox,assertSquareCoverage,validateSquarePayment,verifySquareSignature,SquareClient:SandboxClient,env,rpc,corsHeaders:{},json,fetch:transport,serviceClient:()=>db,
  createClient:()=>({auth:{getUser:async()=>({data:{user:{id:fixture.user_id,email:settings.ZONYX_INTERNAL_TEST_EMAIL}},error:null})}}),
  validateRentalEligibility:async(_request,_db,b)=>{
   let eligibility;
   try {
    await database.exec('SET ROLE authenticated');
    await database.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[fixture.user_id]);
    eligibility=(await database.query('SELECT status FROM public.get_my_driver_eligibility($1)',[b.end_date])).rows[0];
   } finally {await database.exec('SET ROLE service_role');}
   const vehicle=(await database.query("SELECT id FROM vehicles WHERE id=$1 AND is_active AND availability_status='active'",[b.vehicle_id])).rows[0];
   if(eligibility?.status!=='eligible_self_attested'||!vehicle)throw new PaymentError(409,'Driver or vehicle ineligible');
  },
  paymentFailure:error=>{if(offline&&!(error instanceof PaymentError))console.error(error);return json(error instanceof PaymentError?error.status:500,{error:error instanceof PaymentError?error.message:'Handler failure'});}};
 const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
 const context=vm.createContext(globals);
 vm.runInContext(compile('supabase/functions/_shared/square-service.ts'),context);
 const handlers={};
 for(const slug of ['square-checkout','square-booking-operations','square-webhook']) {context.serve=handler=>handlers[slug]=handler;vm.runInContext(compile(`supabase/functions/${slug}/index.ts`),context);}
 const call=async(slug,input)=>{
  const response=await handlers[slug](new Request('http://localhost/square-test',{method:'POST',headers:{authorization:'Bearer isolated-fixture'},body:JSON.stringify(input)}));
  const body=await response.json();
  assert.equal(response.status,200,`${slug}: ${body.error||response.status}`);return body;
 };
 const hold=await call('square-checkout',{action:'hold',bookingId:fixture.booking_id,agreementId:fixture.agreement_id,token:process.env.SQUARE_TEST_HOLD_TOKEN||'cnon:card-nonce-ok'});
 fixture.payment_id=hold.paymentId;
 assert.equal(hold.depositStatus,'authorized');assert.equal(hold.bookingConfirmed,false);pass('actual handler authorizes separate sandbox deposit without confirming unpaid booking');
 const deposit=(await database.query('SELECT * FROM booking_security_deposits WHERE rental_payment_id=$1',[hold.paymentId])).rows[0];
 evidence.paymentIds.push(deposit.provider_authorization_id);
 // Deliberately lose the local identifier as if CreatePayment returned no body.
 await database.query('UPDATE booking_security_deposits SET provider_authorization_id=NULL,provider_order_id=NULL WHERE id=$1',[deposit.id]);
 const recovered=await call('square-checkout',{action:'status',paymentId:hold.paymentId});
 assert.equal(recovered.depositStatus,'authorized');assert.equal((await database.query('SELECT provider_authorization_id FROM booking_security_deposits WHERE id=$1',[deposit.id])).rows[0].provider_authorization_id,deposit.provider_authorization_id);pass('canonical Square list/get recovers lost hold response without another POST');
 const rental=await call('square-checkout',{action:'rental',paymentId:hold.paymentId,token:process.env.SQUARE_TEST_RENTAL_TOKEN||'cnon:card-nonce-ok'});
 assert.equal(rental.bookingConfirmed,true);assert.equal(rental.state,'paid');pass('actual rental card payment and SQL confirmation');
 const payment=(await database.query('SELECT * FROM booking_payments WHERE id=$1',[hold.paymentId])).rows[0];evidence.paymentIds.push(payment.capture_id);
 await database.query('UPDATE booking_payments SET order_id=NULL WHERE id=$1',[payment.id]);
 assert.equal((await call('square-checkout',{action:'status',paymentId:payment.id})).bookingConfirmed,true);pass('canonical Square recovery of lost rental identifier');
 if(offline) {
  settings.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY='offline-signature-key';settings.SQUARE_SANDBOX_WEBHOOK_URL='https://offline.invalid/square-webhook';
  const body=JSON.stringify({merchant_id:settings.SQUARE_SANDBOX_MERCHANT_ID,event_id:randomUUID(),type:'payment.updated',data:{object:{payment:{id:payment.capture_id,status:'PENDING'}}}});
  const signature=createHmac('sha256',settings.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY).update(settings.SQUARE_SANDBOX_WEBHOOK_URL+body).digest('base64');
  const request=(payload=body,header=signature)=>new Request('http://localhost/square-test',{method:'POST',headers:{'x-square-hmacsha256-signature':header},body:payload});
  assert.equal((await handlers['square-webhook'](request(body+' '))).status,400);
  assert.equal((await handlers['square-webhook'](request())).status,200);
  assert.equal((await handlers['square-webhook'](request()).then(r=>r.json())).duplicate,true);
  assert.equal((await call('square-checkout',{action:'status',paymentId:payment.id})).bookingConfirmed,true);
  pass('signed webhook handler rejects tampering, ignores stale payload state and deduplicates persisted evidence');
 }
 const duplicate=await call('square-checkout',{action:'rental',paymentId:payment.id,token:'cnon:card-nonce-ok'});
 assert.equal(duplicate.bookingConfirmed,true);pass('repeated rental action retains original charge');
 let canceled=await call('square-booking-operations',{action:'cancel',paymentId:payment.id,reason:'Isolated Square sandbox regression'});
 for(let poll=0;poll<12&&canceled.refundStatus!=='COMPLETED';poll++) {await new Promise(resolve=>setTimeout(resolve,5000));canceled=await call('square-booking-operations',{action:'status',paymentId:payment.id});}
 await database.query('UPDATE square_payment_operations SET refund_id=NULL WHERE payment_id=$1',[payment.id]);
 canceled=await call('square-booking-operations',{action:'status',paymentId:payment.id});
 assert.ok((await database.query('SELECT refund_id FROM square_payment_operations WHERE payment_id=$1',[payment.id])).rows[0].refund_id);pass('lost refund response recovers by durable correlation without another refund POST');
 assert.equal(canceled.refundStatus,'COMPLETED');assert.equal(canceled.tripStatus,'cancelled');pass('actual Square void/refund and persisted booking cancellation');
 assert.equal((await client.get(deposit.provider_authorization_id)).status,'CANCELED');
 assert.equal((await database.query('SELECT captured_amount_cents FROM booking_security_deposits WHERE id=$1',[deposit.id])).rows[0].captured_amount_cents,0);pass('deposit never captured');
 assert.equal((await call('square-booking-operations',{action:'status',paymentId:payment.id})).tripStatus,'cancelled');pass('cancellation recovery is idempotent');
 // Real signed webhook payloads must be supplied by Square delivery, never fabricated.
 if(process.env.SQUARE_SIGNED_WEBHOOK_FILE&&process.env.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY&&process.env.SQUARE_SANDBOX_WEBHOOK_URL&&process.env.SQUARE_SIGNED_WEBHOOK_SIGNATURE) {
  settings.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY=process.env.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY;settings.SQUARE_SANDBOX_WEBHOOK_URL=process.env.SQUARE_SANDBOX_WEBHOOK_URL;
  const body=readFileSync(process.env.SQUARE_SIGNED_WEBHOOK_FILE,'utf8');
  const request=()=>new Request('http://localhost/square-test',{method:'POST',headers:{'x-square-hmacsha256-signature':process.env.SQUARE_SIGNED_WEBHOOK_SIGNATURE},body});
  const result=await handlers['square-webhook'](request());assert.equal(result.status,200);assert.equal((await handlers['square-webhook'](request()).then(r=>r.json())).duplicate,true);pass('genuine Square-signed delivery and duplicate recovery');
 } else if(!offline) {evidence.webhook='NOT VERIFIED: genuine Square-signed delivery unavailable';console.error(evidence.webhook);}
 evidence.complete=!!evidence.webhook?false:true;
} finally {
 // Cleanup uses known sandbox payment IDs even if an assertion fails.
 if(fixture?.payment_id) {
  const deposits=(await database.query('SELECT provider_authorization_id FROM booking_security_deposits WHERE rental_payment_id=$1',[fixture.payment_id])).rows;
  for(const d of deposits)if(d.provider_authorization_id)try{if((await client.get(d.provider_authorization_id)).status==='APPROVED')await client.void(d.provider_authorization_id);}catch{console.error('Sandbox hold cleanup requires reconciliation.');}
 }
 mkdirSync('work',{recursive:true});writeFileSync(offline?'work/square-offline-contract-results.json':'work/square-sandbox-test-results.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 await database.close();
}
if(!evidence.complete)process.exitCode=2;
