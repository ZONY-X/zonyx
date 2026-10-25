import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const source = ts.transpileModule(readFileSync('supabase/functions/booking-conversion/index.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace(/^import.*;\n/gm, '');
const id = '11111111-1111-4111-8111-111111111111';
function fixture({ auth = true, owner = true, receipt = {}, payment = {}, unavailable = false } = {}) {
  let handler;
  const queries = [];
  const db = { auth: { getUser: async () => ({ data: { user: auth ? { id: 'owner' } : null } }) },
    rpc: async name => { assert.equal(name, 'get_provider_rental_payment_receipt'); return { data: { bookingConfirmed: true, provider: 'square', state: 'paid', reconciliationRequired: false, refundedAmountCents: 0, capturedAmountCents: 158400, amountCents: 158400, currency: 'USD', ...receipt }, error: unavailable ? {} : null }; },
    from: table => { queries.push(table); const query = { select() { return query; }, eq() { return query; }, single: async () => ({ data: table === 'profiles' ? { id: 'profile' } : { id, renter_profile_id: owner ? 'profile' : 'other' } }), maybeSingle: async () => ({ data: { id, provider: 'square', environment: 'live', state: 'paid', amount_cents: 158400, currency: 'USD', paid_at: new Date().toISOString(), capture_id: 'square-capture', ...payment } }) }; return query; }
  };
  vm.runInNewContext(source, { serve: value => handler = value, createClient: (url, key, options) => { assert.equal(key, 'anon'); assert.match(options.global.headers.Authorization, /^Bearer /); return db; }, Deno: { env: { get: name => name === 'SUPABASE_ANON_KEY' ? 'anon' : 'https://fixture.invalid' } }, Response, JSON, Object, Date, Number, String });
  return { queries, request: (body = { bookingId: id }, token = 'Bearer synthetic', method = 'POST') => handler(new Request('https://fixture.invalid', { method, headers: { authorization: token, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) })) };
}
let f = fixture(); let response = await f.request(); const result = await response.json(); assert.equal(result.bookingConfirmed, true); assert.equal(result.purchase.value, 1584); assert.equal(result.purchase.currency, 'USD'); assert.equal(result.purchase.transaction_id, `zonyx_square_${id}`); assert.match(response.headers.get('cache-control'), /no-store/); assert.deepEqual(f.queries, ['profiles', 'bookings', 'booking_payments']);
for (const overrides of [{ receipt: { bookingConfirmed: false } }, { receipt: { state: 'failed' } }, { receipt: { state: 'pending' } }, { receipt: { provider: 'stripe' } }, { receipt: { reconciliationRequired: true } }, { receipt: { refundedAmountCents: 100 } }, { receipt: { capturedAmountCents: 0 } }, { receipt: { amountCents: 1 } }, { receipt: { currency: 'EUR' } }, { payment: { environment: 'unknown' } }, { payment: { capture_id: null } }, { payment: { state: 'authorized' } }, { payment: { paid_at: null } }, { payment: { amount_cents: 0 } }]) {
  const body = await (await fixture(overrides).request()).json(); assert.equal(body.bookingConfirmed, false); assert.equal(body.purchase, null);
}
const sandbox = await (await fixture({payment:{environment:'sandbox'}}).request()).json(); assert.equal(sandbox.bookingConfirmed,true); assert.equal(sandbox.purchase,null); assert.deepEqual(sandbox.paymentSummary,{value:1584,currency:'USD'});
assert.equal((await fixture({ auth: false }).request()).status, 401);
assert.equal((await fixture().request({}, '')).status, 401);
assert.equal((await fixture({ owner: false }).request()).status, 404);
assert.equal((await fixture({ unavailable: true }).request()).status, 503);
assert.equal((await fixture().request({ bookingId: id, value: 1 })).status, 400);
assert.equal((await fixture().request({ bookingId: 'bad' })).status, 400);
assert.equal((await fixture().request({}, '', 'GET')).status, 405);
assert.equal((await fixture().request({}, '', 'OPTIONS')).status, 204);
console.log('PASS: 24 confirmation, amount, currency, owner, live-only, read-only and failure-closed handler scenarios.');
