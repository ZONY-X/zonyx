import {test,expect} from '@playwright/test';
for(const scenario of ['success','hold-declined','hold-unknown','rental-unknown','resume-hold'] as const) test(`Square LIVE sequence: ${scenario}`,async({page})=>{
 const calls:Array<Record<string,unknown>>=[];let paid=scenario==='resume-hold',holds=0,confirmed=false;
 const user={id:'11111111-1111-4111-8111-111111111111',email:'customer@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 await page.addInitScript(user=>{const enc=(v:unknown)=>btoa(JSON.stringify(v)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('sb-square-fixture-auth-token',JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));},user);
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('https://web.squarecdn.com/v1/square.js',route=>route.fulfill({contentType:'application/javascript',body:`window.tokens=[];window.Square={payments:()=>({card:async()=>({attach:async h=>{h.textContent='Synthetic secure card form'},destroy:async()=>{},tokenize:async details=>{window.tokens.push(details);return {status:'OK',token:'cnon:fresh-'+window.tokens.length}}})})};`}));
 await page.route('**square-fixture.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body:unknown=[];let status=200;
  if(path.includes('/auth/v1/user'))body=user;
  if(path.includes('/rest/v1/profiles'))body={id:'customer',is_internal_tester:false,is_admin:false};
  if(path.endsWith('/square-checkout')) {
   const input=route.request().postDataJSON();calls.push(input);expect(input).not.toHaveProperty('amount');expect(input).not.toHaveProperty('card');
   if(input.action==='config')body={environment:'live',checkoutSequence:'rental_then_hold',applicationId:'sq0idp-fixture',locationId:'fixture',amountCents:12096,depositAmountCents:50000,existingPayment:paid?{id:'rental',state:'paid'}:null,canPayRental:!paid,canAuthorizeDeposit:paid&&!confirmed};
   if(input.action==='rental') {
    paid=true;
    if(scenario==='rental-unknown'){status=502;body={error:'Square outcome requires reconciliation.'};}
    else body={paymentId:'rental',state:'paid',depositStatus:'approval_required',bookingConfirmed:false,canAuthorizeDeposit:true};
   }
   if(input.action==='hold') {
    expect(paid).toBe(true);holds++;
    if(scenario==='hold-unknown'){status=502;body={error:'Square outcome requires reconciliation.'};}
    else if(scenario==='hold-declined'&&holds===1)body={paymentId:'rental',state:'paid',depositStatus:'failed',bookingConfirmed:false,canAuthorizeDeposit:true};
    else {confirmed=true;body={paymentId:'rental',state:'paid',depositStatus:'authorized',bookingConfirmed:true,canAuthorizeDeposit:false};}
   }
   if(input.action==='status'){confirmed=true;body={paymentId:'rental',state:'paid',depositStatus:'authorized',bookingConfirmed:true};}
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/booking/square?bookingId=fixture&agreementId=agreement');
 await page.getByRole('button',{name:scenario==='resume-hold'?/Authorize deposit/:/Pay rental and authorize deposit/}).click();
 if(scenario==='rental-unknown'){await expect(page.getByRole('status')).toContainText('requires reconciliation');expect(calls.some(c=>c.action==='hold')).toBe(false);return;}
 if(scenario==='hold-unknown') {
  await expect(page.getByRole('status')).toContainText('requires reconciliation');
  await expect(page.getByRole('button',{name:/Authorize deposit/})).toBeDisabled();
  await page.getByRole('button',{name:'Check existing payment'}).click();
 } else if(scenario==='hold-declined') {
  await expect(page.getByRole('status')).toContainText('Retry only the security deposit');
  await page.getByRole('button',{name:/Authorize deposit/}).click();
 }
 await expect(page.getByRole('status')).toContainText('Booking confirmed');
 expect(calls.filter(c=>c.action==='rental')).toHaveLength(scenario==='resume-hold'?0:1);
 expect(calls.filter(c=>c.action==='hold')).toHaveLength(scenario==='hold-declined'?2:1);
 const financial=calls.filter(c=>c.action==='rental'||c.action==='hold');
 expect(new Set(financial.map(c=>c.token)).size).toBe(financial.length);
 const tokens=await page.evaluate(()=> (window as Window & {tokens?:Array<{amount:string}>}).tokens);
 expect(tokens?.map(t=>t.amount)).toEqual(scenario==='resume-hold'?['500.00']:scenario==='hold-declined'?['120.96','500.00','500.00']:['120.96','500.00']);
});
