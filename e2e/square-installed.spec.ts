import {test,expect} from '@playwright/test';
test('installed production form cannot submit financial actions',async({page})=>{
 const actions:string[]=[];
 await page.route('**/functions/v1/**',async route=>{actions.push(route.request().method()+':'+route.request().url());await route.fulfill({json:{environment:'live',applicationId:'sq0idp-fixture',locationId:'location',paymentsEnabled:false}})});
 await page.route('https://web.squarecdn.com/v1/square.js',route=>route.fulfill({contentType:'application/javascript',body:'window.Square={payments(){return{card:async()=>({attach:async el=>{el.innerHTML="<input aria-label=\\"Square card number\\">"},destroy:async()=>{}})}}}'}));
 await page.goto('/booking/square');
 await expect(page.getByRole('textbox',{name:'Square card number'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Card payments opening soon'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'PayPal · alternative'})).toBeDisabled();
 await expect(page.getByText(/Reservations needing longer coverage/)).toBeVisible();
 expect(actions.every(action=>action.startsWith('GET:')&&action.includes('/square-public-config'))).toBe(true);
});
