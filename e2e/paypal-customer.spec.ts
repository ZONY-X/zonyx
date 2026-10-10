import {test,expect} from '@playwright/test';
for(const scenario of ['success','long-blocked','cancelled'] as const)test(`Prepared customer card checkout: ${scenario}`,async({page})=>{
 const calls:Array<Record<string,unknown>>=[];let paid=scenario==='cancelled',authorized=false;
 const user={id:'11111111-1111-4111-8111-111111111111',email:'customer@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 await page.addInitScript(user=>{const enc=(v:unknown)=>btoa(JSON.stringify(v)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('sb-fazzuetfwwfiqehpnjky-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));},user);
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/web-sdk/v6/core',route=>route.fulfill({contentType:'application/javascript',body:`window.paypal={createInstance:async()=>({findEligibleMethods:async()=>({isEligible:()=>true}),createCardFieldsOneTimePaymentSession:()=>({createCardFieldsComponent:({placeholder})=>{const frame=document.createElement('iframe');frame.title=placeholder;frame.srcdoc='<input aria-label="'+placeholder+'">';return frame;},submit:async(orderId)=>({state:'succeeded',data:{orderId}})})})};`}));
 await page.route('**fazzuetfwwfiqehpnjky.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body:unknown=[];let status=200;
  if(path.includes('/auth/v1/user'))body=user;
  if(path.includes('/rest/v1/profiles'))body={id:'customer-profile',is_internal_tester:false,is_admin:false};
  if(path.endsWith('/paypal-checkout')){
   const input=route.request().postDataJSON();calls.push(input);
   expect(input).not.toHaveProperty('amount');expect(input).not.toHaveProperty('card');
   if(['checkout-config','client-token'].includes(input.action))body={cardEnabled:true,depositEnabled:true,walletEnabled:false,clientToken:'synthetic-browser-token',environment:'sandbox',amountCents:108,existingPayment:paid?{id:'rental',state:'paid',checkout_method:'card'}:null};
   if(input.action==='create'){
    if(scenario==='long-blocked'){status=409;body={error:'These dates need a renewed security deposit. Online payment is unavailable for this trip; no rental payment was started.'};}
    else body={paymentId:'rental',orderId:'rent-order'};
   }
   if(input.action==='capture'){paid=true;body={state:'paid',bookingConfirmed:false};}
   if(input.action==='status')body={provider:'paypal',state:'paid',depositStatus:scenario==='cancelled'?'voided':'disabled',depositAmountCents:100,bookingConfirmed:false,...(scenario==='cancelled'?{tripStatus:'cancelled',refundedAmountCents:108}:{})};
  }
  if(path.endsWith('/paypal-deposit')){
   const input=route.request().postDataJSON();calls.push(input);expect(Object.keys(input).sort()).toEqual(['action','paymentId']);
   if(input.action==='create')body={orderId:'hold-order',amountCents:100};
   if(input.action==='authorize'){authorized=true;body={state:'paid',depositStatus:'authorized',bookingConfirmed:true};}
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/booking/payment?bookingId=fixture-booking&agreementId=fixture-agreement');
 await expect(page.getByRole('button',{name:'PayPal',exact:true})).toHaveCount(0);
 if(scenario==='cancelled'){await expect(page.getByRole('status')).toContainText('Trip cancelled');expect(calls.some(c=>['create','capture','authorize'].includes(String(c.action)))).toBe(false);return;}
 await page.getByLabel('Billing ZIP code').fill('33101');await page.getByRole('button',{name:'Pay ZONYX',exact:true}).click();
 if(scenario==='long-blocked'){await expect(page.getByRole('status')).toContainText('renewed security deposit');expect(calls.some(c=>c.action==='capture')).toBe(false);return;}
 await expect(page.getByRole('heading',{name:'Authorize your security deposit'})).toBeVisible();
 await page.getByRole('button',{name:'Authorize security deposit',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Booking confirmed',exact:true})).toBeVisible();expect(authorized).toBe(true);
 expect(calls.filter(c=>c.action==='capture')).toHaveLength(1);expect(calls.filter(c=>c.action==='authorize')).toHaveLength(1);
 await expect(page.getByText('Internal sandbox testing only.',{exact:false})).toHaveCount(0);
});
