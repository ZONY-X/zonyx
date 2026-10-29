import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pages, SITE_URL } from '../src/lib/seoContent.mjs';
const sitemap = readFileSync('dist/sitemap.xml','utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
assert.equal(new Set(urls).size,urls.length);
assert(urls.length >= Object.keys(pages).length + 1);
const titles = new Set();
const permittedSpa = /^\/(booking\/|auth(?:\?|$)|driver-eligibility$|house-rules$|terms$)/;
for(const url of urls) {
  const path = new URL(url).pathname;
  assert(!/dashboard|\/booking|\/auth/.test(path));
  const file = join('dist',path,'index.html');
  const html = readFileSync(file,'utf8');
  assert.equal((html.match(/<title>/g)||[]).length,1,`${path}: one title`);
  const title = html.match(/<title>(.*?)<\/title>/)?.[1];
  assert(!titles.has(title),`${path}: unique title`); titles.add(title);
  assert.equal((html.match(/rel="canonical"/g)||[]).length,1);
  assert(html.includes(`rel="canonical" href="${url}"`));
  assert.equal((html.match(/<meta name="description"/g)||[]).length,1);
  assert.equal((html.match(/<h1[ >]/g)||[]).length,1);
  assert(!/noindex/.test(html));
  assert(html.includes('href="tel:+13056155237"'));
  assert(html.includes('fbq') && html.includes('clarity.ms'),`${path}: preserve existing tracking bootstrap`);
  const data = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(data.length,1);
  const schema = JSON.parse(data[0][1]);
  assert(schema['@graph'].some(e=>e['@type']==='WebPage' && e.url===url));
  if(path !== '/') assert(schema['@graph'].some(e=>e['@type']==='BreadcrumbList'));
  if(path.startsWith('/vehicle/')) {
    const vehicle = schema['@graph'].find(e=>e['@type']==='Car');
    assert(vehicle && vehicle.offers.priceSpecification.priceCurrency === 'USD');
    assert(Number(vehicle.offers.priceSpecification.price) >= 0);
    assert.equal(vehicle.offers.url,url);
  }
  for(const [,href] of html.matchAll(/<a [^>]*href="([^"#]+)"/g)) {
    if(!href.startsWith('/') || permittedSpa.test(href)) continue;
    const target = href.split(/[?#]/)[0];
    assert(existsSync(join('dist',target,'index.html')) || existsSync(join('dist',target)),`${path}: broken internal link ${href}`);
  }
}
assert(readFileSync('dist/404.html','utf8').includes('noindex,follow'));
const routes = JSON.parse(readFileSync('vercel.json','utf8'));
assert(!routes.rewrites.some(r=>r.source.includes('(.*)')),'No global soft-404 rewrite');
assert(routes.rewrites.some(r=>r.source==='/booking/:path*'));
assert(routes.rewrites.some(r=>r.source==='/vehicle/:id([0-9a-fA-F-]{36})'));
assert(routes.headers.some(r=>r.source==='/booking/:path*' && r.headers.some(h=>h.key==='X-Robots-Tag')));
console.log(`PASS: ${urls.length} pages: unique canonical/title/description, indexable HTML, schema, phone links, internal links, preserved trackers, private noindex and legacy booking routes.`);
