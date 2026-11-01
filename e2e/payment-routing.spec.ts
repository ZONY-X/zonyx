import { test, expect } from '@playwright/test';
for (const scenario of ['square', 'paypal', 'legacy-paypal', 'unavailable'] as const) test(`ZONYX Pay routes ${scenario} without processor promotion`, async ({ page }) => {
  const calls: string[] = [];
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'guest@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
  await page.addInitScript(user => {
    const enc = (v: unknown) => btoa(JSON.stringify(v)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
    const exp = Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('sb-square-fixture-auth-token', JSON.stringify({access_token: `${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));
  }, user);
  await page.route('**/*', route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('https://sandbox.web.squarecdn.com/v1/square.js', route => route.fulfill({contentType:'application/javascript',body:`window.Square={payments:()=>({card:async()=>({attach:async el=>el.textContent='Secure card form',destroy:async()=>{},tokenize:async()=>({status:'OK',token:'cnon:fixture'})})})};`}));
  await page.route('**square-fixture.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname; calls.push(path);
    let body: unknown = []; let status = 200;
    if(path.includes('/auth/v1/user'))body=user;
    if(path.includes('/profiles'))body={id:'profile',is_internal_tester:false,is_admin:false};
    if(path.endsWith('/payment-routing')) {
      expect(route.request().postDataJSON()).toEqual({bookingId:'booking'});
      status=scenario==='unavailable'?503:200;
      body=status===503?{error:'Secure checkout is awaiting activation.'}:{provider:scenario==='square'?'square':'paypal'};
    }
    if(path.endsWith('/square-checkout'))body={applicationId:'app',locationId:'location',amountCents:10000,depositAmountCents:50000,existingPayment:null};
    if(path.endsWith('/paypal-checkout'))body={amountCents:10000,cardEnabled:false};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(`/booking/${scenario==='legacy-paypal'?'square':'payment'}?bookingId=booking&agreementId=agreement`);
  if(scenario==='square')await expect(page.getByRole('button',{name:'Pay',exact:true})).toBeVisible();
  else if(scenario==='unavailable')await expect(page.getByRole('status')).toContainText('unavailable');
  else await expect(page.getByRole('status')).toContainText('not enabled');
  expect(calls.some(p=>p.endsWith('/square-checkout'))).toBe(scenario==='square');
  expect(calls.some(p=>p.endsWith('/paypal-checkout'))).toBe(scenario==='paypal'||scenario==='legacy-paypal');
  await expect(page.locator('main').first()).not.toContainText(/Square|PayPal|coming soon/i);
});
