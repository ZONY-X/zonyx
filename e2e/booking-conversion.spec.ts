import { test, expect, type Page } from '@playwright/test';
const bookingId = '11111111-1111-4111-8111-111111111111';
const transaction = `zonyx_square_${bookingId}`;
async function setup(page: Page, options: { confirmed?: boolean; consent?: string; advertising?: boolean; handoff?: boolean; paidAt?: string; brokenTag?: boolean; invalidReceipt?: boolean; sandbox?: boolean } = {}) {
  const user = { id: bookingId, email: 'synthetic@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
  await page.addInitScript(({user, options, bookingId}) => {
    const enc = (v: unknown) => btoa(JSON.stringify(v)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('sb-square-fixture-auth-token', JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));
    if (options.consent) localStorage.setItem('zonyx:google-consent:v1',JSON.stringify({choice:options.consent,advertising:options.advertising!==false,expires:Date.now()+86400000}));
    if (options.handoff) sessionStorage.setItem('zonyx:confirmed-checkout:v1',JSON.stringify({bookingId,at:Date.now()}));
  }, { user, options, bookingId });
  const tagRequests: string[] = [];
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('https://www.googletagmanager.com/**', route => { tagRequests.push(route.request().url()); return options.brokenTag ? route.abort() : route.fulfill({contentType:'application/javascript',body:'window.syntheticTagLoaded=true;'}); });
  await page.route('**square-fixture.supabase.co/**', route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path.includes('/auth/v1/user')) body = user;
    if (path.includes('/rest/v1/profiles')) body = {id:'fixture',is_admin:false,is_internal_tester:false};
    if (path.endsWith('/booking-conversion')) body = { bookingConfirmed: options.confirmed !== false, paymentSummary:{value:1584,currency:'USD'}, purchase: options.confirmed === false || options.sandbox ? null : {transaction_id:transaction,value:1584,currency:'USD',paidAt:options.paidAt || new Date().toISOString()} };
    return route.fulfill({status:options.invalidReceipt && path.endsWith('/booking-conversion') ? 503 : 200,contentType:'application/json',body:JSON.stringify(body)});
  });
  return tagRequests;
}
async function events(page: Page) {
  return page.evaluate(() => ((window as Window & {dataLayer?: Array<ArrayLike<unknown>>}).dataLayer || []).map(args => Array.from(args)).filter(args => args[0] === 'event' && ['purchase', 'conversion'].includes(String(args[1]))));
}
for (const name of ['direct URL', 'unconfirmed', 'denied', 'old payment', 'verification unavailable', 'blocked tag']) test(`No false purchase: ${name}`, async ({page}) => {
  const requests = await setup(page, { confirmed:name!=='unconfirmed',consent:name==='denied'?'denied':'granted',handoff:name!=='direct URL',paidAt:name==='old payment'?'2020-01-01T00:00:00Z':undefined,invalidReceipt:name==='verification unavailable',brokenTag:name==='blocked tag' });
  await page.goto(`/booking/confirmed?bookingId=${bookingId}`);
  await expect(page.getByRole('heading',{name:name==='unconfirmed'||name==='verification unavailable'?'Booking verification':'Booking Confirmed',exact:true})).toBeVisible();
  expect(await events(page)).toEqual([]);
  if(name==='denied') expect(requests).toHaveLength(0);
});
test('Confirmed purchase uses server value, no deposit; reload and another visit do not duplicate', async ({page}) => {
  await setup(page, {handoff:true,consent:'granted'});
  await page.goto(`/booking/confirmed?bookingId=${bookingId}&link=private-token&email=private@example.invalid`);
  await expect.poll(async () => (await events(page)).length).toBe(2);
  const sent = await events(page);
  expect(sent[0][1]).toBe('purchase'); expect(sent[1][1]).toBe('conversion');
  for(const event of sent) expect(event[2]).toMatchObject({transaction_id:transaction,value:1584,currency:'USD',page_location:'http://127.0.0.1:43876/booking/confirmed'});
  expect(JSON.stringify(sent)).not.toMatch(/private-token|private@example|50000|email|bookingId/);
  await page.reload(); await expect(page.getByRole('heading',{name:'Booking Confirmed',exact:true})).toBeVisible(); expect(await events(page)).toEqual([]);
  await page.goto('/fleet'); await page.goto(`/booking/confirmed?bookingId=${bookingId}`);
  await expect(page.getByRole('heading',{name:'Booking Confirmed',exact:true})).toBeVisible(); expect(await events(page)).toEqual([]);
});
test('Consent granted after verification emits once; rejected consent never emits', async ({page}) => {
  const requests = await setup(page,{handoff:true});
  await page.goto(`/booking/confirmed?bookingId=${bookingId}`);
  await expect(page.getByRole('heading',{name:'Booking Confirmed',exact:true})).toBeVisible(); expect(await events(page)).toEqual([]); expect(requests).toHaveLength(0);
  await page.getByRole('button',{name:'Only necessary',exact:true}).click(); expect(await events(page)).toEqual([]); expect(requests).toHaveLength(0);
  await page.getByRole('button',{name:'Measurement preferences',exact:true}).click();
  await page.getByRole('checkbox',{name:/Also allow Google Ads/}).check();
  await page.getByRole('button',{name:'Allow measurement',exact:true}).click();
  await expect.poll(async ()=>(await events(page)).length).toBe(2);
  await page.getByRole('button',{name:'Measurement preferences',exact:true}).click(); await page.getByRole('button',{name:'Allow measurement',exact:true}).click();
  expect(await events(page)).toHaveLength(2);
});
test('Legacy Stripe success URL no longer declares a completed purchase', async ({page}) => {
  await setup(page,{consent:'granted'}); await page.goto('/booking/success?session_id=cs_old');
  await expect(page.getByRole('heading',{name:'Booking verification',exact:true})).toBeVisible(); expect(await events(page)).toEqual([]); await expect(page.getByText(/Stripe checkout is complete/)).toHaveCount(0);
});

test('Analytics consent alone never grants or sends advertising; a separate explicit choice is required', async ({page}) => {
  await setup(page,{handoff:true,consent:'granted',advertising:false});
  await page.goto(`/booking/confirmed?bookingId=${bookingId}`);
  await expect.poll(async ()=>(await events(page)).length).toBe(1);
  expect((await events(page))[0][1]).toBe('purchase');
  const consent = await page.evaluate(()=>Array.from(window.dataLayer||[]).map((e:ArrayLike<unknown>)=>Array.from(e)).filter(e=>e[0]==='consent'&&e[1]==='update').at(-1)?.[2]);
  expect(consent).toMatchObject({analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  await page.getByRole('button',{name:'Measurement preferences',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:/Also allow Google Ads/})).not.toBeChecked();
  await page.getByRole('checkbox',{name:/Also allow Google Ads/}).check();
  await page.getByRole('button',{name:'Allow measurement',exact:true}).click();
  await expect.poll(async ()=>(await events(page)).length).toBe(2);
  expect((await events(page))[1][1]).toBe('conversion');
});

test('Sandbox confirmations display successfully but never emit Google purchases',async ({page})=>{
  await setup(page,{handoff:true,consent:'granted',sandbox:true});
  await page.goto(`/booking/confirmed?bookingId=${bookingId}`);
  await expect(page.getByRole('heading',{name:'Booking Confirmed',exact:true})).toBeVisible();
  await expect(page.getByText('Payment received: $1,584.00')).toBeVisible();
  expect(await events(page)).toEqual([]);
});
test('Withdrawal in another tab updates an already loaded Google tag to denied', async ({page,context})=>{
  await setup(page,{handoff:true,consent:'granted'});
  await page.goto(`/booking/confirmed?bookingId=${bookingId}`);
  await expect.poll(async ()=>(await events(page)).length).toBe(2);
  const other = await context.newPage();
  await other.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await other.goto('/booking/confirmed');
  await other.evaluate(()=>localStorage.setItem('zonyx:google-consent:v1',JSON.stringify({choice:'denied',advertising:false,expires:Date.now()+86400000})));
  await expect.poll(()=>page.evaluate(()=>Array.from(window.dataLayer||[]).map((e:ArrayLike<unknown>)=>Array.from(e)).filter(e=>e[0]==='consent'&&e[1]==='update').at(-1)?.[2])).toMatchObject({analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied'});
  expect(await events(page)).toHaveLength(2);
});
