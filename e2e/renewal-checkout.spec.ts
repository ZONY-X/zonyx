import {test,expect} from '@playwright/test';
for(const scenario of ['login','guest','admin','processing','paid','preview','other-account','declined'] as const)test(`Square renewal ${scenario}`,async({page})=>{
 const calls:string[]=[];const apiRef=process.env.RENEWAL_UI_BASE_URL?'fazzuetfwwfiqehpnjky':'renewal-fixture';const host=new URL(process.env.RENEWAL_UI_BASE_URL||'http://127.0.0.1:43879').hostname;
 const user={id:'11111111-1111-4111-8111-111111111111',email:'guest@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 if(scenario!=='login'&&scenario!=='preview')await page.addInitScript(({user,apiRef})=>{const enc=(v:unknown)=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem(`sb-${apiRef}-auth-token`,JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));},{user,apiRef});
 await page.route('**/*',route=>['127.0.0.1','localhost',host].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('https://web.squarecdn.com/v1/square.js',route=>route.fulfill({contentType:'application/javascript',body:`window.squareTokens=0;window.Square={payments:()=>({card:async()=>({attach:async(el)=>{el.innerHTML='<label>Card number<input aria-label="Card number" /></label>';},destroy:async()=>{},tokenize:async()=>{window.squareTokens++;return {status:'OK',token:'cnon:fixture'};}})})};`}));
 await page.route(`**${apiRef}.supabase.co/**`,async route=>{
  const path=new URL(route.request().url()).pathname;let body:unknown=[];let status=200;
  if(path.includes('/auth/v1/user'))body=user;
  if(path.includes('/profiles'))body={id:'profile',is_admin:scenario==='admin'};
  if(path.endsWith('get_my_account_capabilities'))body=[{profile_id:'profile',can_guest:true,can_host:false,can_admin:scenario==='admin'}];
  if(path.endsWith('/renewal-checkout')){
   const input=route.request().postDataJSON();calls.push(input.action);expect(input).not.toHaveProperty('amount');
   if(scenario==='other-account'){status=403;body={error:'This renewal belongs to a different account.'};}
   else if(scenario==='declined'&&input.action==='pay'){status=402;body={error:'The card declined this operation. Check the existing payment before retrying.'};}
   else body={period_id:'period-fixture',reservation_number:'SYNTHETIC-RESERVATION',period_start:'2098-06-01',period_end:'2098-07-01',amount_cents:158400,currency:'usd',payment_status:scenario==='paid'||input.action==='pay'?'paid':scenario==='processing'?'processing':'payment_due',paid_at:scenario==='paid'||input.action==='pay'?'2098-06-01T12:00:00Z':null,plan_status:'active',can_pay:scenario!=='paid'&&scenario!=='admin',preview:scenario==='preview',admin_inspection:scenario==='admin',checkout_state:scenario==='processing'?'processing':null,provider:'square',environment:'live',applicationId:'sq0idp-fixture',locationId:'location-fixture'};
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/booking/renewal?'+(scenario==='preview'?'preview=signed-fixture':'periodId=period-fixture'));
 if(scenario==='login'){await expect(page.getByRole('link',{name:'Sign in to continue'})).toBeVisible();expect(calls).toEqual([]);return;}
 if(scenario==='other-account'){await expect(page.getByRole('alert')).toContainText('different account');return;}
 await expect(page.getByText(/\$1,584.00/)).toBeVisible();
 if(scenario==='paid'){await expect(page.getByRole('heading',{name:'Renewal Payment Confirmed'})).toBeVisible();await expect(page.getByRole('button',{name:'Pay Renewal',exact:true})).toHaveCount(0);return;}
 await expect(page.getByRole('textbox',{name:'Card number'})).toBeVisible();
 const pay=page.getByRole('button',{name:'Pay Renewal',exact:true});
 if(scenario==='processing'){await expect(pay).toBeDisabled();expect(calls).toEqual(['details']);return;}
 await expect(pay).toBeEnabled();await pay.click();
 if(scenario==='admin'||scenario==='preview'){await expect(page.getByText(/No payment or deposit authorization can be submitted/)).toBeVisible();expect(calls).toEqual(['details']);expect(await page.evaluate(()=>Reflect.get(window,'squareTokens'))).toBe(0);}
 else{await expect.poll(()=>calls.includes('pay')).toBe(true);expect(await page.evaluate(()=>Reflect.get(window,'squareTokens'))).toBe(1);if(scenario==='declined'){await expect(page.getByText(/The card declined this operation/)).toBeVisible();await expect(pay).toBeDisabled();}}
 expect(page.url()).toContain('/booking/renewal');
});
