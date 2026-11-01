import { test, expect } from '@playwright/test';
for (const scenario of ['switch', 'rejected', 'unavailable'] as const) test(`Admin ZONYX Pay ${scenario}`, async ({ page }) => {
  let active = 'square'; let version = 0; const writes: unknown[] = [];
  const user = {id:'11111111-1111-4111-8111-111111111111',email:'admin@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
  await page.addInitScript(user => {
    const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); const exp = Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('sb-square-fixture-auth-token', JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));
    localStorage.setItem('zonyx-account-mode','admin');
  },user);
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.route('**square-fixture.supabase.co/**',async route=>{
    const path = new URL(route.request().url()).pathname; let body: unknown = []; let status = 200;
    if(path.includes('/auth/v1/user')) body=user;
    if(path.endsWith('get_my_account_capabilities')) body=[{profile_id:'admin',can_guest:true,can_host:true,can_admin:true}];
    if(path.endsWith('admin-payment-runtime')) {
      const input=route.request().postDataJSON();
      if(input.action==='activate') {writes.push(input);if(scenario==='rejected'){status=409;body={error:'Processor change failed. Refresh ZONYX Pay and try again.'};}else{expect(input.expectedVersion).toBe(version);active=input.provider;version++;}}
      if(status===200) body={active_provider:active,version,providers:['square','paypal','authorize_net','chase','clover','finix','stripe'].map(id=>({id,status:id==='stripe'?'Historical only':['square','paypal'].includes(id)?'Ready':'Not configured',activatable:['square','paypal'].includes(id)}))};
      if(scenario==='unavailable'){status=503;body={error:'Configuration unavailable'};}
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('/admin-dashboard');await page.getByRole('tab',{name:'ZONYX Pay',exact:true}).click();
  const panel=page.getByRole('region',{name:'ZONYX Pay configuration'});
  if(scenario==='unavailable'){await expect(panel.getByRole('alert')).toContainText('Configuration unavailable');await expect(panel.getByLabel('Processor',{exact:true})).toHaveCount(0);return;}
  await expect(panel).toContainText('Active processor: square');
  for(const id of ['authorize_net','chase','clover','finix','stripe']) await expect(panel.locator(`option[value="${id}"]`)).toHaveAttribute('disabled','');
  await panel.getByLabel('Processor',{exact:true}).selectOption('paypal');await panel.getByRole('button',{name:'Set active processor'}).click();
  await expect(page.getByRole('alertdialog')).toContainText('square to paypal');expect(writes).toHaveLength(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(writes).toHaveLength(0);
  await panel.getByLabel('Reason (optional)',{exact:true}).fill('Maintenance');
  await panel.getByRole('button',{name:'Set active processor'}).click();await page.getByRole('button',{name:'Confirm activation'}).click();
  if(scenario==='rejected'){await expect(panel.getByRole('status')).toContainText('Processor change failed');await expect(panel).toContainText('Active processor: square');return;}
  await expect(panel).toContainText('Active processor: paypal');expect(writes[0]).toMatchObject({provider:'paypal',reason:'Maintenance'});
  await panel.getByLabel('Processor',{exact:true}).selectOption('none');await panel.getByRole('button',{name:'Set active processor'}).click();await expect(page.getByRole('alertdialog')).toContainText('blocks new transactions');await page.getByRole('button',{name:'Confirm activation'}).click();
  await expect(panel).toContainText('Active processor: No active processor');await expect(panel).toContainText('New transactions are blocked.');
});
