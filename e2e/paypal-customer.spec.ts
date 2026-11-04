import {test,expect} from '@playwright/test';
for(const scenario of ['success','long-blocked','cancelled','vault-pending','deposit-uncertain','reload-paid','switch-booking','capture-failed'] as const)test(`Prepared customer card checkout: ${scenario}`,async({page})=>{
 const calls:Array<Record<string,unknown>>=[];let paid=['cancelled','reload-paid','switch-booking'].includes(scenario),authorized=false;
 const user={id:'11111111-1111-4111-8111-111111111111',email:'customer@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 await page.addInitScript(user=>{const enc=(v:unknown)=>btoa(JSON.stringify(v)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('sb-fazzuetfwwfiqehpnjky-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));},user);
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/web-sdk/v6/core',route=>route.fulfill({contentType:'application/javascript',body:`window.paypal={createInstance:async()=>({findEligibleMethods:async()=>({isEligible:()=>true}),createCardFieldsOneTimePaymentSession:()=>({createCardFieldsComponent:({placeholder})=>{const frame=document.createElement('iframe');frame.title=placeholder;frame.srcdoc='<input aria-label="'+placeholder+'">';return frame;},submit:async(orderId)=>({state:'succeeded',data:{orderId}})})})};`}));
 await page.route('**fazzuetfwwfiqehpnjky.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body:unknown=[];let status=200;
  if(path.includes('/auth/v1/user'))body=user;
  if(path.includes('/rest/v1/profiles'))body={id:'customer-profile',is_internal_tester:false,is_admin:false};
  if(path.endsWith('/payment-routing'))body={provider:'paypal'};
  if(path.endsWith('/paypal-checkout')){
   const input=route.request().postDataJSON();calls.push(input);
   expect(input).not.toHaveProperty('amount');expect(input).not.toHaveProperty('card');
   if(['checkout-config','client-token'].includes(input.action))body={cardEnabled:true,depositEnabled:true,walletEnabled:false,clientToken:'synthetic-browser-token',environment:'sandbox',amountCents:108,depositAmountCents:100,existingPayment:paid && input.bookingId!=='next-booking'?{id:'rental',state:'paid',checkout_method:'card'}:null};
   if(input.action==='create'){
    if(scenario==='long-blocked'){status=409;body={error:'These dates need a renewed security deposit. Online payment is unavailable for this trip; no rental payment was started.'};}
    else body={paymentId:'rental',orderId:'rent-order'};
   }
   if(input.action==='capture'){paid=scenario!=='capture-failed';body={state:paid?'paid':'failed',bookingConfirmed:false};}
   if(input.action==='status')body={provider:'paypal',state:'paid',depositStatus:scenario==='cancelled'?'voided':'disabled',depositAmountCents:100,bookingConfirmed:false,...(scenario==='cancelled'?{tripStatus:'cancelled',refundedAmountCents:108}:{})};
  }
  if(path.endsWith('/paypal-vault')){
   const input=route.request().postDataJSON();calls.push(input);
   expect(input.action).toBe('store-payment-token');expect(input.paymentId).toBe('rental');expect(input).not.toHaveProperty('setupToken');
   body={paymentMethod:{id:'saved-card'}};
   if(scenario==='vault-pending'){status=409;body={error:'Vault pending'};}
  }
  if(path.endsWith('/paypal-deposit')){
   const input=route.request().postDataJSON();calls.push(input);expect(Object.keys(input).sort()).toEqual(['action','paymentId','paymentSourceId']);expect(input.paymentSourceId).toBe('saved-card');
   if(input.action==='create')body={orderId:'hold-order',amountCents:100};
   if(input.action==='auto-authorize'){authorized=true;body={state:'paid',depositStatus:'authorized',bookingConfirmed:true};if(scenario==='deposit-uncertain'){status=502;body={error:'Unknown authorization'};}}
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/booking/payment?bookingId=fixture-booking&agreementId=fixture-agreement');
 await expect(page.getByRole('button',{name:'PayPal',exact:true})).toHaveCount(0);
 if(scenario==='cancelled'){await expect(page.getByRole('status')).toContainText('Trip cancelled');expect(calls.some(c=>['create','capture','authorize'].includes(String(c.action)))).toBe(false);return;}
 if(scenario==='switch-booking'){
  await expect(page.getByRole('status')).toContainText('Rental paid');
  await expect(page.getByRole('button',{name:'Pay ZONYX',exact:true})).toBeHidden();
  await page.evaluate(()=>{history.pushState({},'', '/booking/payment?bookingId=next-booking&agreementId=next-agreement');window.dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page.getByRole('button',{name:'Complete security deposit'})).toHaveCount(0);
  await expect(page.getByLabel('Billing ZIP code')).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('securely handled');
  expect(calls.some(c=>['create','capture','auto-authorize'].includes(String(c.action)))).toBe(false);return;
 }
 if(scenario==='reload-paid'){
  await expect(page.getByRole('status')).toContainText('Rental paid');
  expect(calls.some(c=>['create','capture','auto-authorize'].includes(String(c.action)))).toBe(false);
  await page.getByRole('button',{name:'Complete security deposit'}).click();
  await expect(page.getByRole('heading',{name:'Booking confirmed',exact:true})).toBeVisible();
  expect(calls.some(c=>['create','capture'].includes(String(c.action)))).toBe(false);return;
 }
 await page.getByLabel('Billing ZIP code').fill('33101');await page.getByRole('button',{name:'Pay ZONYX',exact:true}).click();
 if(scenario==='capture-failed'){await expect(page.getByRole('status')).toContainText('needs reconciliation');await expect(page.getByRole('button',{name:'Complete security deposit'})).toHaveCount(0);expect(calls.some(c=>c.action==='auto-authorize')).toBe(false);return;}
 if(scenario==='long-blocked'){await expect(page.getByRole('status')).toContainText('renewed security deposit');expect(calls.some(c=>c.action==='capture')).toBe(false);return;}
 if(['vault-pending','deposit-uncertain'].includes(scenario)){
  await expect(page.getByRole('status')).toContainText('needs reconciliation');
  await expect(page.getByRole('heading',{name:'Booking confirmed',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Check payment status'}).click();
  await expect(page.getByRole('status')).toContainText('Rental paid');
  expect(calls.filter(c=>c.action==='capture')).toHaveLength(1);
  expect(calls.filter(c=>c.action==='auto-authorize')).toHaveLength(scenario==='vault-pending'?0:1);return;
 }
 await expect(page.getByRole('heading',{name:'Booking confirmed',exact:true})).toBeVisible();expect(authorized).toBe(true);
 expect(calls.filter(c=>c.action==='capture')).toHaveLength(1);expect(calls.filter(c=>c.action==='auto-authorize')).toHaveLength(1);
 await expect(page.getByText('Internal sandbox testing only.',{exact:false})).toHaveCount(0);
});
