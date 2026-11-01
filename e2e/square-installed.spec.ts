import {test,expect} from '@playwright/test';
test('public checkout entry without a reservation does not load a processor or submit payment',async({page})=>{
 const actions:string[]=[];
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/functions/v1/**',async route=>{actions.push(route.request().url());await route.abort();});
 await page.goto('/booking/square');
 await expect(page.getByRole('link',{name:'Choose your Tesla'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Pay',exact:true})).toHaveCount(0);
 await expect(page.locator('main').first()).not.toContainText(/Square|PayPal/);
 expect(actions).toEqual([]);
});
