import assert from 'node:assert/strict';
import handler from '../api/measurement-policy.js';
for (const [headers, expected] of [[{'x-vercel-ip-country':'US'},true],[{'x-vercel-ip-country':'GB'},false],[{'x-vercel-ip-country':'DE'},false],[{'x-vercel-ip-country':'CH'},false],[{},false],[{'x-vercel-ip-country':'US','sec-gpc':'1'},false],[{'x-vercel-ip-country':'US',dnt:'1'},false]]) {
  const result={};
  handler({method:'GET',headers},{setHeader:(k,v)=>result[k]=v,status(n){result.status=n;return this;},json(body){result.body=body;}});
  assert.equal(result.status,200); assert.deepEqual(result.body,{analyticsAllowed:expected}); assert.match(result['Cache-Control'],/no-store/);
}
const result={}; handler({method:'POST',headers:{'x-vercel-ip-country':'US'}},{setHeader(){},status(n){result.status=n;return this;},json(body){result.body=body;}});
assert.equal(result.status,405);assert.deepEqual(result.body,{analyticsAllowed:false});
console.log('PASS: regional eligibility, unknown region, browser opt outs, no caching and method guards.');
