import {test,expect} from '@playwright/test';
test('An unverified GA4 stream cannot collect private URLs even with previously saved consent',async({page})=>{
  const requests:string[]=[];
  await page.addInitScript(()=>localStorage.setItem('zonyx:google-consent:v1',JSON.stringify({choice:'granted',advertising:true,expires:Date.now()+86400000})));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();requests.push(url.href);return route.abort();});
  await page.goto('/booking/confirmed?bookingId=11111111-1111-4111-8111-111111111111&link=private-example');
  await expect(page.getByRole('heading',{name:'Booking verification',exact:true})).toBeVisible();
  expect(requests.filter(url=>/googletagmanager|google-analytics|googleadservices/.test(url))).toEqual([]);
  await expect(page.getByRole('button',{name:'Allow measurement',exact:true})).toHaveCount(0);
  await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0);
});
