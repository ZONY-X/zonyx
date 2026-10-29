import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getVehicleCanonicalPath, getVehicleSlug } from '../src/lib/vehicleSlug.mjs';
import { SITE_URL, pages, pageSchema, vehicleCopy, vehicleSchema, rentalQuestions, PHONE_HREF, PHONE_LABEL } from '../src/lib/seoContent.mjs';

const rootDir = process.cwd();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link = (path, text) => `<a href="${esc(path)}">${esc(text)}</a>`;
const contact = `<p>${link(PHONE_HREF, `Call to reserve · ${PHONE_LABEL}`)} · ${link('/contact', 'Contact ZONYX')}</p>`;
const questions = `<section><h2>Before you reserve</h2>${rentalQuestions.map(([q,a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}<p>${link('/driver-eligibility','Driver eligibility')} · ${link('/house-rules','House rules')} · ${link('/terms','Terms')}</p></section>`;

async function fetchVehicles() {
  // Deployment environment wins over local defaults. Never use privileged keys.
  for (const file of ['.env.local', '.env']) {
    let text = '';
    try { text = await readFile(join(rootDir,file),'utf8'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
      if(m && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? m[3] ?? m[4];
    }
  }
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!base || !key) throw new Error('Missing public Supabase configuration.');
  const url = new URL('/rest/v1/vehicles',base);
  url.search = new URLSearchParams({select:'id,vehicle_identifier,year,brand,name,category,color,image_url,images,base_daily_rate_cents',is_active:'eq.true',availability_status:'eq.active',order:'vehicle_identifier.asc'}).toString();
  const response = await fetch(url,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Unable to fetch public vehicles: ${response.status}`);
  const vehicles = await response.json();
  if(!Array.isArray(vehicles) || !vehicles.length) throw new Error('Refusing to publish an empty vehicle sitemap.');
  return vehicles;
}
function documentFor(template, path, page, schema, content, image = `${SITE_URL}/favicon-v2.png`, noindex = false) {
  let html = template;
  const meta = (selector, value) => {
    const pattern = new RegExp(`<meta ${selector}[^>]*>`, 'g');
    html = html.replace(pattern,'');
    return value;
  };
  html = html.replace(/<title>[\s\S]*?<\/title>/,'').replace(/<link rel="canonical"[^>]*>/g,'');
  for(const [attribute,name] of [['name','description'],['property','og:title'],['property','og:description'],['property','og:url'],['property','og:image'],['name','twitter:title'],['name','twitter:description'],['name','twitter:image']]) meta(`${attribute}="${name}"`,'');
  const url = `${SITE_URL}${path}`;
  const json = JSON.stringify(schema).replace(/</g,'\\u003c');
  const head = `<title>${esc(page.title)}</title><meta name="description" content="${esc(page.description)}"><link rel="canonical" href="${esc(url)}"><meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}"><meta name="twitter:title" content="${esc(page.title)}"><meta name="twitter:description" content="${esc(page.description)}"><meta name="twitter:image" content="${esc(image)}">${noindex ? '<meta name="robots" content="noindex,follow">' : ''}<script id="zonyx-structured-data" type="application/ld+json">${json}</script><style>.seo-snapshot{background:#020607;color:#fff;min-height:100vh;font:16px/1.8 system-ui;padding:3rem max(1.5rem,calc((100vw - 1100px)/2))}.seo-snapshot a{color:#6ee7ce;margin-right:.8rem}.seo-snapshot img{max-width:100%;height:auto}.seo-snapshot h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.2}.seo-snapshot li,.seo-snapshot details{margin:1rem 0}</style>`;
  html = html.replace('</head>',`${head}</head>`);
  const nav = `<nav aria-label="Main navigation">${link('/','ZONYX')} ${link('/fleet','Fleet')} ${link('/tesla-rental-miami','Tesla rentals')} ${link('/long-term-rentals','Long-term')} ${link('/contact','Contact')}</nav>`;
  html = html.replace('<div id="root"></div>',`<div id="root"><main class="seo-snapshot">${nav}<h1>${esc(page.h1)}</h1><p>${esc(page.intro)}</p>${contact}${content}<footer><p>ZONYX · 601 Brickell Key Dr #11, Miami, FL 33131 · ${link(PHONE_HREF,PHONE_LABEL)}</p></footer></main></div>`);
  return html;
}
const vehicles = await fetchVehicles();
const template = await readFile(join(rootDir,'dist/index.html'),'utf8');
const urls = [];
const listing = rows => `<ul>${rows.map(v => `<li>${link(getVehicleCanonicalPath(v,vehicles),`${v.year} ${v.brand} ${v.name} rental in Miami`)} — Daily base rate $${(v.base_daily_rate_cents / 100).toFixed(2)}. Check dates for availability.</li>`).join('')}</ul>`;
for(const [path,page] of Object.entries(pages)) {
  let content = '';
  if(['/', '/fleet', '/tesla-rental-miami'].includes(path)) {
    const rows = path === '/tesla-rental-miami' ? vehicles.filter(v => v.brand.toLowerCase() === 'tesla') : vehicles;
    content = `<section><h2>${path === '/tesla-rental-miami' ? 'Compare Tesla models for your trip' : 'Explore the electric fleet'}</h2>${listing(rows)}</section>${questions}`;
  } else if(path === '/long-term-rentals') {
    content = `<h2>What to include in a monthly rental inquiry</h2><ul><li>Exact pickup and return dates and times.</li><li>Your preferred Tesla, Cybertruck or other EV.</li><li>Pickup location, expected mileage and charging plans.</li></ul><h2>Review the full trip quote</h2><p>Ask our team to confirm availability, the total quote, mileage conditions, deposit, protection requirements and return arrangements. No monthly price or discount is guaranteed.</p>${link('/tesla-rental-miami','Compare Tesla models')} ${questions}`;
  } else if(path === '/contact') content = `<p>${link('mailto:support@gozonyx.com','support@gozonyx.com')}</p>${link('/fleet','View vehicles and check dates')}`;
  else content = `<p>Learn about approval, referral attribution and qualifying completed bookings in the ZONYX Partner Program. Sign in to apply through the online platform.</p>${link('/auth?redirectTo=%2Fpartners%23apply','Partner application')}`;
  const dir = path === '/' ? join(rootDir,'dist') : join(rootDir,'dist',path.slice(1));
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'index.html'), documentFor(template,path,page,pageSchema(path,page.title,path === '/' ? [] : [['Home','/'],[page.h1,path]]),content));
  urls.push(`${SITE_URL}${path}`);
}
for(const v of vehicles) {
  const path = getVehicleCanonicalPath(v,vehicles);
  const image = v.image_url || v.images?.[0] || '/placeholder.svg';
  const page = vehicleCopy(v);
  const content = `<nav aria-label="Breadcrumb">${link('/','Home')} / ${link('/fleet','Fleet')} / ${esc(v.brand+' '+v.name)}</nav><img src="${esc(image)}" alt="${esc(page.h1)}" fetchpriority="high"><p>Daily base rate: $${(v.base_daily_rate_cents / 100).toFixed(2)}. Check dates for availability and the full rental total before payment.</p><p>${link(`/booking/${v.id}`,'Check availability')}</p>${questions}<nav aria-label="Related rentals">${link('/tesla-rental-miami','Compare Tesla rentals')} ${link('/long-term-rentals','Long-term rental inquiries')} ${link('/fleet','Explore the full fleet')}</nav>`;
  const dir = join(rootDir,'dist','vehicle',getVehicleSlug(v,vehicles));
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'index.html'),documentFor(template,path,page,vehicleSchema(v,path,image),content,new URL(image,SITE_URL).href));
  urls.push(`${SITE_URL}${path}`);
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${esc(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
await writeFile(join(rootDir,'dist/sitemap.xml'),sitemap);
await writeFile(join(rootDir,'public/sitemap.xml'),sitemap);
await writeFile(join(rootDir,'dist/404.html'),documentFor(template,'/404',{title:'Page not found | ZONYX',description:'This ZONYX page could not be found. Explore the fleet or contact our Miami team.',h1:'Page not found',intro:'Choose a vehicle from the fleet or contact ZONYX for rental assistance.'},pageSchema('/404','Page not found'),link('/fleet','Explore the fleet'),undefined,true));
console.log(`Generated ${Object.keys(pages).length} public pages, ${vehicles.length} vehicle pages, a 404 page and ${urls.length} sitemap entries.`);
