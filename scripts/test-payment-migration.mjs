// In-memory PostgreSQL fixtures only. No network or Supabase project connection.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE public.profiles(id uuid PRIMARY KEY,user_id uuid,is_internal_tester boolean DEFAULT false,is_admin boolean DEFAULT false);
  CREATE TABLE public.bookings(id uuid PRIMARY KEY,renter_profile_id uuid,host_profile_id uuid,vehicle_id uuid,start_date date,end_date date,pickup_time time,dropoff_time time,trip_status text,subtotal_cents bigint,service_fee_cents bigint,taxes_cents bigint,grand_total_cents bigint,currency text,terms_accepted_at timestamptz,rental_agreement_accepted_at timestamptz,stripe_checkout_session_id text,stripe_customer_id text,stripe_payment_method_id text,authorization_hold_payment_intent_id text,pickup_location text,dropoff_location text,fulfillment_method text);
  CREATE TABLE public.booking_rental_agreements(id uuid PRIMARY KEY,booking_id uuid,guest_auth_user_id uuid,guest_profile_id uuid,accepted_at timestamptz,trip_financial_summary jsonb);
  CREATE TABLE public.vehicle_blocked_periods(vehicle_id uuid,start_at timestamptz,end_at timestamptz);
  CREATE FUNCTION public.current_profile_id() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.profile',true),'')::uuid $$;
  CREATE FUNCTION public.current_profile_is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  GRANT USAGE ON SCHEMA public TO service_role,authenticated,anon;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  GRANT SELECT ON public.bookings TO authenticated;
`);
const migration = readdirSync("supabase/migrations").find(file => file.endsWith("_provider_neutral_paypal_checkout.sql"));
await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
const expandedMigration = readdirSync("supabase/migrations").find(file => file.endsWith("_paypal_expanded_card_checkout.sql"));
await db.exec(readFileSync(`supabase/migrations/${expandedMigration}`, "utf8"));
const user = "11111111-1111-4111-8111-111111111111";
const profile = "22222222-2222-4222-8222-222222222222";
const vehicle = "33333333-3333-4333-8333-333333333333";
await db.query("INSERT INTO profiles VALUES($1,$2,true,false)", [profile,user]);
const id = n => `44444444-4444-4444-8444-${String(n).padStart(12,"0")}`;
const aid = n => `55555555-5555-4555-8555-${String(n).padStart(12,"0")}`;
async function fixture(n, options = {}) {
  const summary = { vehicle_id: vehicle, start_date: "2038-01-01", end_date: "2038-01-02", pickup_time: "13:00", dropoff_time: "13:00", subtotal_cents: 10000, service_fee_cents: 1200, taxes_cents: 896, final_total_cents: options.total || 12096, currency: "usd", pickup_location: "Brickell", dropoff_location: "Brickell", fulfillment_method: "pickup", internal_test: options.internal !== false, authorization_hold_amount_cents: 50000 };
  await db.query("INSERT INTO bookings VALUES($1,$2,$2,$3,'2038-01-01','2038-01-02','13:00','13:00','pending_payment',10000,1200,896,12096,'usd',now(),now(),$4,NULL,NULL,NULL,'Brickell','Brickell','pickup')", [id(n),profile,vehicle,options.stripe || null]);
  await db.query("INSERT INTO booking_rental_agreements VALUES($1,$2,$3,$4,now(),$5)", [aid(n),id(n),user,profile,summary]);
}
await db.exec("SET ROLE service_role");
async function prepare(n) { return (await db.query("SELECT prepare_paypal_rental_payment($1,$2,$3,'sandbox') AS result",[id(n),aid(n),user])).rows[0].result; }
async function expanded(n, method) { return (await db.query("SELECT prepare_paypal_expanded_payment($1,$2,$3,'sandbox',$4) AS result",[id(n),aid(n),user,method])).rows[0].result; }
let passed=0;
async function check(name,fn) { await fn(); console.log(`PASS: ${name}`); passed++; }
await check("atomic duplicate order preparation has exactly one dispatcher",async()=>{
  await fixture(1); const results=await Promise.all([prepare(1),prepare(1)]);
  assert.equal(results.filter(result=>result.dispatch).length,1); assert.equal(results[0].payment.id,results[1].payment.id);
});
const payment=(await prepare(1)).payment;
await check("unknown creation cannot create a second order",async()=>{assert.equal((await prepare(1)).dispatch,false);assert.equal((await prepare(1)).payment.state,"creating");});
await check("client roles cannot invoke financial RPCs or write provider identifiers",async()=>{
  await db.exec("SET ROLE authenticated");
  await assert.rejects(db.query("SELECT claim_paypal_rental_capture($1,$2)",[payment.id,user]),/permission denied/);
  await assert.rejects(db.query("UPDATE booking_payments SET order_id='bad' WHERE id=$1",[payment.id]),/permission denied/);
  assert.equal((await db.query("SELECT * FROM booking_payments")).rows.length,0);
  await db.exec("SET ROLE service_role");
});
await check("different providers cannot claim one booking",async()=>{await assert.rejects(db.query("SELECT reserve_rental_payment_provider($1,$2,'stripe',$3,'sandbox')",[id(1),aid(1),user]),/conflicts/);});
await check("legacy Stripe identifiers cannot be attached to a PayPal booking",async()=>{await assert.rejects(db.query("UPDATE bookings SET stripe_checkout_session_id='cs_fixture' WHERE id=$1",[id(1)]),/cannot use Stripe/);});
await check("agreement amount mismatch is rejected before provider reservation",async()=>{await fixture(2,{total:1});await assert.rejects(prepare(2),/price mismatch/);});
await check("non-internal bookings are rejected",async()=>{await fixture(3,{internal:false});await assert.rejects(prepare(3),/Internal testing required/);});
await check("historical Stripe transactions cannot be repurposed for PayPal",async()=>{await fixture(4,{stripe:"cs_fixture_historical"});await assert.rejects(prepare(4),/Existing Stripe transaction/);});
await db.query("SELECT attach_paypal_rental_order($1,'fixture-order','https://www.sandbox.paypal.com/checkoutnow')",[payment.id]);
await check("capture compare-and-set allows only one request including concurrent callers",async()=>{
  const results=await Promise.allSettled([db.query("SELECT claim_paypal_rental_capture($1,$2)",[payment.id,user]),db.query("SELECT claim_paypal_rental_capture($1,$2)",[payment.id,user])]);
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
});
await check("capture in flight blocks booking cancellation and edits",async()=>{
  await assert.rejects(db.query("SELECT record_paypal_payment_state($1,'cancelled')",[payment.id]),/reconciled/);
  await assert.rejects(db.query("UPDATE bookings SET trip_status='cancelled' WHERE id=$1",[id(1)]),/requires verified/);
  await assert.rejects(db.query("UPDATE bookings SET grand_total_cents=1 WHERE id=$1",[id(1)]),/terms are locked/);
});
await check("capture amount mismatch cannot become paid",async()=>{await assert.rejects(db.query("SELECT finalize_paypal_rental_payment($1,'fixture-order','fixture-capture',1,'usd','disabled')",[payment.id]),/integrity failure/);});
await check("completed capture is idempotent, creates a separate disabled deposit and does not confirm trip",async()=>{
  const args=[payment.id,"fixture-order","fixture-capture",12096,"usd","disabled"];
  await db.query("SELECT finalize_paypal_rental_payment($1,$2,$3,$4,$5,$6)",args);
  await db.query("SELECT finalize_paypal_rental_payment($1,$2,$3,$4,$5,$6)",args);
  assert.equal((await db.query("SELECT trip_status FROM bookings WHERE id=$1",[id(1)])).rows[0].trip_status,"pending_payment");
  const deposits=(await db.query("SELECT * FROM booking_security_deposits WHERE booking_id=$1",[id(1)])).rows;
  assert.equal(deposits.length,1); assert.equal(deposits[0].status,"disabled"); assert.equal(deposits[0].provider_authorization_id,null);
  await assert.rejects(db.query("SELECT finalize_paypal_rental_payment($1,'fixture-order','other-capture',12096,'usd','disabled')",[payment.id]),/Duplicate capture/);
  await assert.rejects(db.query("UPDATE bookings SET trip_status='confirmed' WHERE id=$1",[id(1)]),/requires verified/);
});
await check("external reversals remain reconciliation-required despite delayed completion",async()=>{
  await db.query("SELECT record_paypal_payment_state($1,'reconciliation_required')",[payment.id]);
  await db.query("SELECT finalize_paypal_rental_payment($1,'fixture-order','fixture-capture',12096,'usd','disabled')",[payment.id]);
  assert.equal((await db.query("SELECT state FROM booking_payments WHERE id=$1",[payment.id])).rows[0].state,"reconciliation_required");
});
await check("cancellation and failed capture cannot confirm a booking",async()=>{
  await fixture(5);const p=(await prepare(5)).payment;
  await db.query("SELECT attach_paypal_rental_order($1,'fixture-cancel','https://www.sandbox.paypal.com/checkoutnow')",[p.id]);
  await db.query("SELECT record_paypal_payment_state($1,'cancelled')",[p.id]);
  await assert.rejects(db.query("SELECT claim_paypal_rental_capture($1,$2)",[p.id,user]),/Capture already claimed/);
  assert.equal((await db.query("SELECT trip_status FROM bookings WHERE id=$1",[id(5)])).rows[0].trip_status,"pending_payment");
});
await check("legacy Stripe-only bookings remain editable and retain historical identifiers",async()=>{
  await db.query("UPDATE bookings SET stripe_customer_id='cus_fixture_preserved' WHERE id=$1",[id(4)]);
  assert.equal((await db.query("SELECT stripe_checkout_session_id FROM bookings WHERE id=$1",[id(4)])).rows[0].stripe_checkout_session_id,"cs_fixture_historical");
});
await check("neutral receipt reports capture independently of Stripe history",async()=>{
  const receipt=(await db.query("SELECT get_provider_rental_payment_receipt($1) AS result",[id(1)])).rows[0].result;
  assert.equal(receipt.provider,"paypal"); assert.equal(receipt.capturedAmountCents,12096); assert.equal(receipt.reconciliationRequired,true); assert.equal(receipt.bookingConfirmed,false);
  assert.equal((await db.query("SELECT get_provider_rental_payment_receipt($1) AS result",[id(4)])).rows[0].result,null);
  await db.exec("SET ROLE authenticated");
  assert.equal((await db.query("SELECT get_provider_rental_payment_receipt($1) AS result",[id(1)])).rows[0].result,null);
  await db.exec(`SET test.profile='${profile}'`);
  assert.equal((await db.query("SELECT get_provider_rental_payment_receipt($1) AS result",[id(1)])).rows[0].result.provider,"paypal");
  await db.exec("SET ROLE service_role");
});
await check("overlapping rental already capturing/paid cannot be captured again",async()=>{
  await fixture(6); const p=(await prepare(6)).payment;
  await db.query("SELECT attach_paypal_rental_order($1,'fixture-overlap','https://www.sandbox.paypal.com/checkoutnow')",[p.id]);
  await assert.rejects(db.query("SELECT claim_paypal_rental_capture($1,$2)",[p.id,user]),/availability changed/);
});
await check("missing accepted currency fails before order creation",async()=>{
  await fixture(7);await db.query("UPDATE booking_rental_agreements SET trip_financial_summary=trip_financial_summary-'currency' WHERE id=$1",[aid(7)]);
  await assert.rejects(prepare(7),/price mismatch/);
});
await check("invalid payer identity cannot claim capture",async()=>{
  await fixture(8);const p=(await prepare(8)).payment;
  await db.query("SELECT attach_paypal_rental_order($1,'fixture-owner','https://www.sandbox.paypal.com/checkoutnow')",[p.id]);
  await assert.rejects(db.query("SELECT claim_paypal_rental_capture($1,$2)",[p.id,id(99)]),/Accepted agreement required/);
});
console.log(`${passed} PostgreSQL payment integration checks passed.`);


await check("expanded card choice is atomic, persistent and cannot switch wallets", async()=>{
  await fixture(21); const p=await expanded(21,"card");
  assert.equal(p.payment.checkout_method,"card"); assert.equal(p.dispatch,true);
  assert.equal((await expanded(21,"card")).dispatch,false);
  await assert.rejects(expanded(21,"paypal_wallet"), /method is locked/);
  await assert.rejects(db.query("SELECT attach_paypal_rental_order($1,'card-fixture','https://www.sandbox.paypal.com/checkoutnow')",[p.payment.id]),/no longer eligible/);
  await db.query("SELECT attach_paypal_rental_order($1,'card-fixture',NULL)",[p.payment.id]);
  assert.equal((await expanded(21,"card")).payment.order_id,"card-fixture");
});
await check("wallet method retains approval URL and rejects card-style attach", async()=>{
  await fixture(22); const p=await expanded(22,"paypal_wallet");
  await assert.rejects(db.query("SELECT attach_paypal_rental_order($1,'wallet-fixture',NULL)",[p.payment.id]),/no longer eligible/);
  await db.query("SELECT attach_paypal_rental_order($1,'wallet-fixture','https://www.sandbox.paypal.com/checkoutnow')",[p.payment.id]);
  await assert.rejects(expanded(22,"card"),/method is locked/);
});
await check("unapproved wallet adapters and client prepare execution fail closed", async()=>{
  await fixture(23); await assert.rejects(expanded(23,"apple_pay"),/Unsupported payment method/);
  await db.exec("SET ROLE authenticated"); await assert.rejects(expanded(23,"card"),/permission denied/); await db.exec("SET ROLE service_role");
});
console.log(`${passed} total migration checks passed`);

await db.close();
