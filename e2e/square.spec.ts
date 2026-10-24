import {test,expect} from '@playwright/test';
for(const scenario of ['success','unknown-hold','existing-paypal','resume-rental','recover-hold'] as const)test(`Square checkout: ${scenario}`,async({page})=>{
 const calls:Array<Record<string,unknown>>=[];
 const user={id:'11111111-1111-4111-8111-111111111111',email:'tester@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 await page.addInitScript(user=>{const enc=(v:unknown)=>btoa(JSON.stringify(v)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('sb-square-fixture-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));},user);
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('https://sandbox.web.squarecdn.com/v1/square.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Square={payments:()=>({card:async()=>({attach:async h=>{h.textContent='Synthetic secure card form'},destroy:async()=>{},tokenize:async()=>({status:'OK',token:'cnon:synthetic-card'})})})};`}));
 await page.route('**square-fixture.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body:unknown=[];let status=200;
   if(path.includes('/auth/v1/user'))body=user;
   if(path.includes('/rest/v1/profiles'))body={id:'tester',is_internal_tester:true,is_admin:false};
   if(path.endsWith('/booking-conversion'))body={bookingConfirmed:true,purchase:{transaction_id:'zonyx_square_11111111-1111-4111-8111-111111111111',value:120.96,currency:'USD',paidAt:new Date().toISOString()}};
   if(path.endsWith('/square-checkout')){
     const input=route.request().postDataJSON();calls.push(input);expect(input).not.toHaveProperty('amount');expect(input).not.toHaveProperty('card');
     if(input.action==='config'){
       if(scenario==='existing-paypal'){status=409;body={error:'This booking is locked to its existing provider.'};}
       else body={applicationId:'fake-app',locationId:'fake-location',amountCents:12096,depositAmountCents:50000,existingPayment:(scenario==='resume-rental' || scenario==='recover-hold' && calls.some(c=>c.action==='hold'))?{id:'rental',state:'creating'}:null,canPayRental:scenario==='resume-rental' || scenario==='recover-hold' && calls.some(c=>c.action==='hold')};
     }
     if(input.action==='hold'){
       if(scenario==='unknown-hold' || scenario==='recover-hold'){status=502;body={error:'Square outcome requires reconciliation. Check the existing payment; do not switch providers.'};}
       else body={paymentId:'rental',state:'creating',depositStatus:'authorized',bookingConfirmed:false};
     }
     if(input.action==='rental')body={paymentId:'rental',state:'paid',depositStatus:'authorized',bookingConfirmed:true};
     if(input.action==='status')body={paymentId:'rental',state:'creating',depositStatus:'authorized',bookingConfirmed:false};
   }
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/booking/square?bookingId=fixture&agreementId=agreement');
 if(scenario==='existing-paypal'){await expect(page.getByRole('status')).toContainText('locked to its existing provider');expect(calls.every(c=>c.action==='config')).toBe(true);return;}
 if(scenario!=='resume-rental')await page.getByRole('button',{name:'Pay',exact:true}).click();
 if(scenario==='recover-hold') {
   await expect(page.getByRole('status')).toContainText('requires reconciliation');
   await page.getByRole('button',{name:'Check existing payment'}).click();
   await expect(page.getByRole('status')).toContainText('Deposit authorized');
 }
 if(scenario==='unknown-hold'){
   await expect(page.getByRole('status')).toContainText('requires reconciliation');
   await expect(page.getByRole('button',{name:'Pay',exact:true})).toBeDisabled();
   await expect(page.getByRole('link',{name:'Use alternative PayPal checkout'})).toHaveCount(0);
   expect(calls.filter(c=>c.action==='hold')).toHaveLength(1);expect(calls.some(c=>c.action==='rental')).toBe(false);return;
 }
 await page.getByRole('button',{name:'Pay',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Booking Confirmed'})).toBeVisible();
 expect(calls.filter(c=>c.action==='rental')).toHaveLength(1);
 expect(calls.filter(c=>c.action==='hold')).toHaveLength(scenario==='resume-rental'?0:1);
});
