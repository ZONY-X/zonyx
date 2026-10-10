import {test,expect} from '@playwright/test';
for(const scenario of ['success','abandoned-deposit','unknown-capture','unsupported-trip','wrong-return','deposit-refund'] as const) test(`Standard redirected checkout: ${scenario}`,async({page})=>{
 const calls:Array<Record<string,unknown>>=[];
 let created=scenario==='wrong-return', paid=false, authorized=false, claim=false, depositStarted=false;
 const user={id:'11111111-1111-4111-8111-111111111111',email:'customer@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 await page.addInitScript(user=>{const enc=(v:unknown)=>btoa(JSON.stringify(v)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('sb-fazzuetfwwfiqehpnjky-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));},user);
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 const returnPath='/booking/paypal/return?payment_id=rental&bookingId=fixture-booking&agreementId=fixture-agreement';
 await page.route('https://www.sandbox.paypal.com/checkoutnow?**',async route=>{
   const phase=new URL(route.request().url()).searchParams.get('token');
   await route.fulfill({status:302,headers:{location:`http://127.0.0.1:43873${returnPath}${phase==='deposit'?'&phase=deposit':''}${phase==='deposit'&&scenario==='abandoned-deposit'?'&cancelled=true':''}`},body:''});
 });
 await page.route('**fazzuetfwwfiqehpnjky.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body:unknown=[];let status=200;
  if(path.includes('/auth/v1/user'))body=user;
  if(path.includes('/rest/v1/profiles'))body={id:'customer-profile',is_internal_tester:false,is_admin:false};
  if(path.endsWith('/rest/v1/booking_payments'))body=[{id:'rental',provider:'paypal'}];
  if(path.endsWith('/paypal-checkout')){
   const input=route.request().postDataJSON();calls.push(input);expect(input).not.toHaveProperty('amount');expect(input).not.toHaveProperty('card');
   if(input.action==='checkout-config')body={walletEnabled:true,cardEnabled:false,depositEnabled:true,amountCents:35140,environment:'sandbox',existingPayment:created?{id:'rental',state:paid?'paid':claim?'capturing':'awaiting_approval',checkout_method:'paypal_wallet'}:null};
   if(input.action==='create'){
     if(scenario==='unsupported-trip'){status=409;body={error:'These dates need a renewed security deposit. No rental payment was started.'};}
     else {created=true;body={paymentId:'rental',url:'https://www.sandbox.paypal.com/checkoutnow?token=rent'};}
   }
   if(input.action==='capture'){
     claim=true;
     if(scenario==='unknown-capture'){status=502;body={error:'Unknown capture outcome; check existing payment.'};}
     else {paid=true;body={state:'paid',bookingConfirmed:false};}
   }
   if(input.action==='status'){
     if(claim&&scenario==='unknown-capture')paid=true;
     body={provider:'paypal',state:paid?'paid':'awaiting_approval',tripStatus:authorized?'confirmed':'pending_payment',depositStatus:authorized?'authorized':depositStarted?'approval_required':'disabled',depositAmountCents:75000,bookingConfirmed:authorized};
   }
  }
  if(path.endsWith('/paypal-deposit')){
   const input=route.request().postDataJSON();calls.push({...input,phase:'deposit'});expect(Object.keys(input).sort()).toEqual(['action','paymentId']);
   if(input.action==='create'){depositStarted=true;body={orderId:'hold-order',amountCents:75000,url:'https://www.sandbox.paypal.com/checkoutnow?token=deposit'};}
   if(input.action==='authorize'){
     if(scenario==='deposit-refund'){status=502;body={error:'Existing deposit requires reconciliation.'};}
     else {authorized=true;body={state:'paid',depositStatus:'authorized',bookingConfirmed:true};}
   }
   if(input.action==='status')body={depositStatus:'approval_required',operationState:scenario==='deposit-refund'?'authorizing':'awaiting_approval',bookingConfirmed:false};
  }
  if(path.endsWith('/paypal-booking-operations')){calls.push({...route.request().postDataJSON(),phase:'refund'});body={ok:true,state:'cancelled',refundCents:35140};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(scenario==='wrong-return'?returnPath.replace('payment_id=rental','payment_id=other'):'/booking/payment?bookingId=fixture-booking&agreementId=fixture-agreement');
 if(scenario==='wrong-return'){await expect(page.getByRole('status')).toContainText('identity conflicts');expect(calls.some(c=>['capture','authorize'].includes(String(c.action)))).toBe(false);return;}
 await expect(page.getByText('Rental total: $351.40')).toBeVisible();
 await page.getByRole('button',{name:'Continue to PayPal',exact:true}).click();
 if(scenario==='unsupported-trip'){await expect(page.getByRole('status')).toContainText('renewed security deposit');expect(calls.some(c=>c.action==='capture')).toBe(false);return;}
 if(scenario==='unknown-capture'){await expect(page.getByRole('status')).toContainText('Unknown capture');await page.getByRole('button',{name:'Check payment status'}).click();}
 await expect(page.getByRole('heading',{name:'Approve your deposit hold'})).toBeVisible();
 await expect(page.getByText('Separate authorization hold: $750.00 — not charged.')).toBeVisible();
 await page.getByRole('button',{name:'Approve security deposit with PayPal',exact:true}).click();
 if(scenario==='abandoned-deposit'){
   await expect(page.getByRole('status')).toContainText('Deposit approval is incomplete');
   expect(calls.filter(c=>c.phase==='deposit'&&c.action==='authorize')).toHaveLength(0);
   await expect(page.getByRole('button',{name:'Approve security deposit with PayPal'})).toBeEnabled();
 }else if(scenario==='deposit-refund'){
   await expect(page.getByRole('status')).toContainText('requires reconciliation');
   await page.getByRole('button',{name:'Check payment status'}).click();
   await page.getByRole('button',{name:'Cancel unconfirmed booking and request full rental refund'}).click();
   await expect(page.getByRole('status')).toContainText('refund verified');
   expect(calls.filter(c=>c.phase==='refund')).toHaveLength(1);
 }else await expect(page.getByRole('heading',{name:'Booking confirmed',exact:true})).toBeVisible();
 expect(calls.filter(c=>c.action==='capture')).toHaveLength(1);
 expect(calls.filter(c=>c.action==='create'&&!c.phase)).toHaveLength(1);
 expect(calls.filter(c=>c.phase==='deposit'&&c.action==='capture')).toHaveLength(0);
});
