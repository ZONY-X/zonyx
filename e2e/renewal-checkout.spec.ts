import {test,expect} from '@playwright/test';
for(const scenario of ['login','checkout','processing','paid','preview','cancel','other-account'] as const)test(`Guest renewal ${scenario}`,async({page})=>{
 const calls:string[]=[];const apiRef=process.env.RENEWAL_UI_BASE_URL?'fazzuetfwwfiqehpnjky':'renewal-fixture';const host=new URL(process.env.RENEWAL_UI_BASE_URL||'http://127.0.0.1:43879').hostname;
 const user={id:'11111111-1111-4111-8111-111111111111',email:'guest@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
 if(scenario!=='login'&&scenario!=='preview')await page.addInitScript(({user,apiRef})=>{const enc=(v:unknown)=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem(`sb-${apiRef}-auth-token`,JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user}));},{user,apiRef});
 await page.route('**/*',route=>['127.0.0.1','localhost',host].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Hosted Stripe fixture</h1>'}));
 await page.route(`**${apiRef}.supabase.co/**`,async route=>{
  const path=new URL(route.request().url()).pathname;let body:unknown=[];let status=200;
  if(path.includes('/auth/v1/user'))body=user;
  if(path.includes('/profiles'))body={id:'guest-profile',is_admin:false};
  if(path.endsWith('get_my_account_capabilities'))body=[{profile_id:'guest-profile',can_guest:true,can_host:false,can_admin:false}];
  if(path.endsWith('/renewal-checkout')){
   const input=route.request().postDataJSON();calls.push(input.action);expect(input).not.toHaveProperty('amount');expect(input).not.toHaveProperty('amountCents');expect(input).not.toHaveProperty('token');
   if(scenario==='other-account'){status=403;body={error:'This renewal belongs to a different account.'};}
   else if(input.action==='checkout')body={url:'https://checkout.stripe.com/c/pay/cs_test_fixture'};
   else body={period_id:'period-fixture',reservation_number:'SYNTHETIC-RESERVATION',period_start:'2098-06-01',period_end:'2098-07-01',amount_cents:158400,currency:'usd',payment_status:scenario==='paid'?'paid':scenario==='processing'?'processing':'payment_due',paid_at:scenario==='paid'?'2098-06-01T12:00:00Z':null,plan_status:'active',can_pay:scenario!=='paid',preview:scenario==='preview',checkout_state:scenario==='processing'?'processing':null};
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/booking/renewal?'+(scenario==='preview'?'preview=signed-fixture':'periodId=period-fixture')+(scenario==='processing'||scenario==='paid'?'&return=success':scenario==='cancel'?'&return=cancel':''));
 if(scenario==='login'){await expect(page.getByRole('link',{name:'Sign in to continue'})).toHaveAttribute('href',/redirectTo/);expect(calls).toEqual([]);return;}
 if(scenario==='other-account'){await expect(page.getByRole('alert')).toContainText('different account');await expect(page.getByRole('button',{name:'Pay Renewal',exact:true})).toHaveCount(0);return;}
 await expect(page.getByText(/\$1,584.00/)).toBeVisible();
 if(scenario==='paid'){await expect(page.getByRole('heading',{name:'Renewal Payment Confirmed'})).toBeVisible();await expect(page.getByRole('button',{name:'Pay Renewal',exact:true})).toHaveCount(0);return;}
 if(scenario==='processing'){await expect(page.getByRole('heading',{name:'Pay Your Rental Renewal'})).toBeVisible();await expect(page.getByRole('button',{name:'Pay Renewal',exact:true})).toBeDisabled();expect(calls).toEqual(['status']);return;}
 if(scenario==='cancel'){await expect(page.getByText(/existing reservation was not canceled/)).toBeVisible();expect(calls).toEqual(['details']);return;}
 await page.getByRole('button',{name:'Pay Renewal',exact:true}).click();
 if(scenario==='preview'){await expect(page.getByText(/Preview only — no card was charged/)).toBeVisible();expect(calls).toEqual(['details']);}
 else{await expect(page.getByRole('heading',{name:'Hosted Stripe fixture'})).toBeVisible();expect(calls).toEqual(['details','checkout']);}
});
