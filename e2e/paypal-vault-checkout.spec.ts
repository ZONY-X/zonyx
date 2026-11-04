import { test, expect } from '@playwright/test';
for (const scenario of ['success','card-failed','vault-error','create-lost','capture-error','deposit-error','reload-paid','stale-deposit-response','reload-confirmed'] as const) {
 test(`Purchase-first one-card checkout: ${scenario}`, async ({page}) => {
  const calls: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
  await page.addInitScript(user=>{const enc=(v:unknown)=>btoa(JSON.stringify(v)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('sb-fazzuetfwwfiqehpnjky-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_at:exp,expires_in:3600,token_type:'bearer',user}));},user);
  await page.route('**/*', route => ['localhost','127.0.0.1',...(process.env.ZONYX_VERIFY_URL?[new URL(process.env.ZONYX_VERIFY_URL).hostname]:[])].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.route('**/web-sdk/v6/core',route=>route.fulfill({contentType:'application/javascript',body:`window.paypal={createInstance:async()=>({findEligibleMethods:async()=>({isEligible:()=>true}),createCardFieldsOneTimePaymentSession:()=>({createCardFieldsComponent:({placeholder})=>{const f=document.createElement('iframe');f.title=placeholder;f.srcdoc='<input aria-label="'+placeholder+'">';return f},submit:async(token)=>{if(token!=='order')throw Error('wrong order');return {state:'${scenario==='card-failed'?'failed':'succeeded'}',data:{orderId:token}}}})})};`}));
  await page.route('**fazzuetfwwfiqehpnjky.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body:unknown=[];let status=200;
   if(path.includes('/auth/v1/user'))body=user;
   if(path.includes('/rest/v1/profiles'))body={id:'profile',is_internal_tester:false,is_admin:false};
   if(path.endsWith('/payment-routing'))body={provider:'paypal'};
   if(/\/paypal-(checkout|vault|deposit)$/.test(path)){
    const input=route.request().postDataJSON();calls.push(input.action);
    expect(input).not.toHaveProperty('card');expect(input).not.toHaveProperty('amount');
    if(['checkout-config','client-token'].includes(input.action))body={cardEnabled:true,depositEnabled:true,clientToken:'fixture-token',environment:'sandbox',amountCents:50,depositAmountCents:100,existingPayment:['reload-paid','reload-confirmed'].includes(scenario)?{id:'payment',state:'paid',checkout_method:'card'}:scenario==='create-lost'&&calls.includes('create')?{id:'payment',state:'creating',checkout_method:'card'}:null};
    if(input.action==='store-payment-token'){expect(input.paymentId).toBe('payment');expect(input).not.toHaveProperty('setupToken');body={paymentMethod:{id:'saved-card'}};if(scenario==='vault-error'){status=502;body={error:'Store failed'}}}
    if(input.action==='create'){expect(input).not.toHaveProperty('paymentSourceId');body={paymentId:'payment',orderId:'order'};if(scenario==='create-lost')return route.abort();}
    if(input.action==='capture'){body={state:'paid'};if(scenario==='capture-error'){status=502;body={error:'Capture uncertain'}}}
    if(input.action==='auto-authorize'){expect(input.paymentSourceId).toBe('saved-card');body={state:'paid',bookingConfirmed:scenario!=='stale-deposit-response',depositStatus:'authorized'};if(scenario==='deposit-error'){status=502;body={error:'Authorization uncertain'}}}
    if(input.action==='status')body={state:'paid',bookingConfirmed:['success','stale-deposit-response','reload-confirmed'].includes(scenario),depositStatus:['success','stale-deposit-response','reload-confirmed'].includes(scenario)?'authorized':'capability_verification_required'};
   }
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('/booking/payment?bookingId=fixture&agreementId=agreement');
  if(scenario==='reload-confirmed'){await expect(page.getByRole('heading',{name:'Confirmed',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check payment status'})).toHaveCount(0);expect(calls.filter(c=>['create','capture','auto-authorize'].includes(c))).toEqual([]);return;}
  if(scenario==='reload-paid'){await expect(page.getByRole('status')).toContainText('Rental paid');expect(calls.filter(c=>['create','capture','auto-authorize','create-setup-token'].includes(c))).toEqual([]);return;}
  await expect(page.locator('iframe[title="Card number"]')).toBeVisible();
  await page.getByLabel('Billing ZIP code').fill('33131');
  await page.getByRole('button',{name:'Pay ZONYX',exact:true}).click();
  if(['card-failed','create-lost','capture-error'].includes(scenario)){
   await expect(page.getByRole('status')).toContainText('needs reconciliation');
   expect(calls.filter(c=>c==='auto-authorize')).toEqual([]);
   expect(calls.filter(c=>c==='create')).toHaveLength(1);
  }else if(scenario==='vault-error'){
   await expect(page.getByRole('status')).toContainText('Rental paid');
   expect(calls.filter(c=>c==='capture')).toHaveLength(1);
   expect(calls.filter(c=>c==='auto-authorize')).toHaveLength(0);
  }else if(scenario==='deposit-error'){
   await expect(page.getByRole('status')).toContainText('Rental paid');
   await expect(page.getByRole('heading',{name:'Confirmed',exact:true})).toHaveCount(0);
  }else{
   await expect(page.getByRole('button',{name:'Check payment status'})).toHaveCount(0);
   await expect(page.getByText('Rental total:',{exact:false})).toHaveCount(0);
   await expect(page.getByRole('heading',{name:'Confirmed',exact:true})).toBeVisible();
   expect(calls.filter(c=>['create','capture','store-payment-token','auto-authorize'].includes(c))).toEqual(['create','capture','store-payment-token','auto-authorize']);
  }
  expect(calls).not.toContain('create-setup-token');
  expect(calls).not.toContain('store-setup-token');
  expect(calls.filter(c=>c==='create')).toHaveLength(1);
  expect(errors).toEqual([]);
  if (['success','deposit-error','vault-error','stale-deposit-response'].includes(scenario)) await expect(page.getByRole('button',{name:'Pay ZONYX',exact:true})).toBeHidden();
  else await expect(page.getByRole('button',{name:'Pay ZONYX',exact:true})).toBeDisabled();
 });
}
