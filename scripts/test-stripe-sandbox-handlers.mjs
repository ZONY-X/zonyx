import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
for (const slug of ['stripe-checkout', 'stripe-checkout-sandbox']) {
  let handler;
  const source = ts.transpileModule(readFileSync(`supabase/functions/${slug}/index.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace(/^import.*;\n/gm, '');
  vm.runInNewContext(source, { Response, JSON, serve: value => handler = value });
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    const response = await handler(new Request('https://fixture.invalid', { method }));
    assert.equal(response.status, method === 'POST' ? 403 : method === 'OPTIONS' ? 204 : 405);
  }
}
console.log('PASS: both retired Stripe checkout endpoints deny all new sessions without credentials, database writes or provider requests.');
