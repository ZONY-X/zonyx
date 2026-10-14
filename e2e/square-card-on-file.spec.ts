import {test,expect} from '@playwright/test';
for(const kind of ['renewal','test'] as const)for(const scenario of ['consent','paid','card-pending'] as const)test(`Square ${kind}: ${scenario}`,async({page})=>{
 const api=process.env.RENEWAL_UI_BASE_URL?'fazzuetfwwfiqehpnjky':'renewal-fixture';const host=new URL(process.env.RENEWAL_UI_BASE_URL||'http://127.0.0.1:43879').hostname;const calls:string[]=[];let paid=scenario!=='consent';
 await page.route('**/*',route=>['localhost','127.0.0.1',host].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('https://web.squarecdn.com/v1/square.js',route=>route.fulfill({contentType:'application/javascript',body:`window.tokenizations=0;window.Square={payments:()=>({card:async()=>({attach:async el=>el.innerHTML='<input aria-label="Card number"/>',destroy:async()=>{},configure:async options=>window.configuredPostal=options.postalCode,tokenize:async details=>{window.tokenizations++;window.verificationDetails=details;return{status:'OK',token:'cnon:fixture'};}})})};`}));
 await page.route(`**${api}.supabase.co/**`,async route=>{
  const path=new URL(route.request().url()).pathname;let body:unknown=[];
  if(path.endsWith('/renewal-checkout')){
   const input=route.request().postDataJSON();calls.push(input.action);expect(input[kind==='test'?'testLink':'paymentLink']).toBe('a'.repeat(64));expect(input).not.toHaveProperty('amount');
   if(input.action==='pay'){expect(input.storageConsent).toBe(true);expect(input.futureConsent).toBe(true);expect(input.payer.email).toBe('payer@example.invalid');expect(input.termsVersion).toBe('zonyx-square-cof-v1');paid=true;}
   body={period_id:'period',test_id:kind==='test'?'test':undefined,reservation_number:'ZNX-000150',period_start:'2026-10-21',period_end:'2026-11-21',amount_cents:kind==='test'?5:158400,currency:'usd',payment_status:paid?'paid':'payment_due',paid_at:paid?'2026-10-13':null,can_pay:!paid,live_test:kind==='test',provider:'square',environment:'live',applicationId:'sq0idp-fixture',locationId:'location',cof_required:true,terms_version:'zonyx-square-cof-v1',authorization_terms:'I authorize card storage and future charges according to my rental agreement. I may withdraw authorization.',card_saved:paid&&scenario!=='card-pending',future_authorization_active:paid&&scenario!=='card-pending',card_last4:paid?'1111':null,card_save_pending:scenario==='card-pending',management_url:paid?'/booking/renewal?authorization='+'f'.repeat(64):null};
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/booking/renewal?'+(kind==='test'?'test=':'link=')+'a'.repeat(64));
 await expect(page.getByText(new RegExp(kind==='test'?'\\$0.05':'\\$1,584.00')).first()).toBeVisible();
 if(scenario==='paid'){await expect(page.getByText(/Square confirmed your saved card ending 1111/)).toBeVisible();await expect(page.getByRole('button',{name:/^Pay/})).toHaveCount(0);return;}
 if(scenario==='card-pending'){await expect(page.getByText(/Card storage or authorization verification is pending/)).toBeVisible();await expect(page.getByText(/Square confirmed your saved card/)).toHaveCount(0);await expect(page.getByRole('button',{name:'Verify Saved Card'})).toBeVisible();return;}
 await expect(page.getByRole('textbox',{name:'Card number'})).toBeVisible();
 const button=page.getByRole('button',{name:kind==='test'?'Pay $0.05':'Pay Renewal',exact:true});await expect(button).toBeDisabled();
 await page.getByLabel('First name',{exact:true}).fill('Test');await page.getByLabel('Last name',{exact:true}).fill('Payer');await page.getByLabel('Cardholder email',{exact:true}).fill('payer@example.invalid');await page.getByLabel('Billing postal code',{exact:true}).fill('10003');
 await page.getByRole('checkbox',{name:'I consent to Square securely saving my card for ZONYX.'}).check();await expect(button).toBeDisabled();expect(calls).toEqual(['details']);
 await page.getByRole('checkbox',{name:/I am the cardholder/}).check();await expect(button).toBeEnabled();await button.click();
 await expect(page.getByText(/Square confirmed your saved card ending 1111/)).toBeVisible();
 expect(await page.evaluate(()=>Reflect.get(window,'tokenizations'))).toBe(1);
 expect(await page.evaluate(()=>Reflect.get(window,'verificationDetails'))).toMatchObject({intent:'CHARGE_AND_STORE',amount:kind==='test'?'0.05':'1584.00',customerInitiated:true,sellerKeyedIn:false});
 expect(await page.evaluate(()=>Reflect.get(window,'configuredPostal'))).toBe('10003');expect(calls.filter(x=>x==='pay')).toHaveLength(1);
});
test('Private withdrawal stops authorization without any payment',async({page})=>{
 const api=process.env.RENEWAL_UI_BASE_URL?'fazzuetfwwfiqehpnjky':'renewal-fixture';const host=new URL(process.env.RENEWAL_UI_BASE_URL||'http://127.0.0.1:43879').hostname;const calls:string[]=[];let withdrawn=false;
 await page.route('**/*',route=>['localhost','127.0.0.1',host].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route(`**${api}.supabase.co/**`,async route=>{let body:unknown=[];if(new URL(route.request().url()).pathname.endsWith('/renewal-checkout')){const input=route.request().postDataJSON();calls.push(input.action);if(input.action==='withdrawAuthorization')withdrawn=true;body={authorization_view:true,authorization_state:withdrawn?'withdrawn':'active',withdrawn,terms_text:'Accepted future-charge terms',card_last4:'1111'};}await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto('/booking/renewal?authorization='+'f'.repeat(64));await page.getByRole('button',{name:'Withdraw Future-Charge Authorization'}).click();await page.getByRole('button',{name:'Confirm Withdrawal'}).click();await expect(page.getByText(/Authorization withdrawn. No new merchant/)).toBeVisible();expect(calls).not.toContain('pay');
});
