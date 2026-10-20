import {test,expect} from '@playwright/test';
const program={reconciliation_days:14,thresholds_active:false,tiers:[{name:'Bronze',rate_bps:300,completed_threshold:0},{name:'Silver',rate_bps:400,completed_threshold:5},{name:'Gold',rate_bps:500,completed_threshold:15},{name:'Platinum',rate_bps:600,completed_threshold:30}]};
const partner={id:'p1',contact_name:'Test Concierge',business_name:'Synthetic Hotel',business_type:'Hotel concierge',email:'synthetic@example.invalid',phone:'3055550101',status:'approved',referral_code:'ZXTEST12345678'};
for(const width of [390,1280])test(`partner application and dashboard ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const user={id:'11111111-1111-4111-8111-111111111111',email:'synthetic@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const expires=Math.floor(Date.now()/1000)+3600,encode=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');
 await page.addInitScript(s=>localStorage.setItem('sb-fazzuetfwwfiqehpnjky-auth-token',JSON.stringify(s)),{user,access_token:encode({alg:'HS256'})+'.'+encode({sub:user.id,exp:expires,role:'authenticated'})+'.fixture',refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer'});
 let applied=false;
 await page.route('**fazzuetfwwfiqehpnjky.supabase.co/**',async route=>{const path=new URL(route.request().url()).pathname;let body:unknown=[];
 if(path==='/auth/v1/user')body=user;
 else if(path.includes('/profiles'))body=[];
 else if(path.endsWith('/get_my_account_capabilities'))body=[{profile_id:'profile',can_admin:true,can_guest:true,can_host:true,email:user.email,full_name:'Test Admin'}];
 else if(path.endsWith('/get_my_platform_capabilities'))body=[];
 else if(path.endsWith('/admin_partner_data'))body={partners:[partner],program,bookings:[],ledger:[],audit:[]};
 else if(path.endsWith('/admin_partner_action')){expect(route.request().postDataJSON()._action).toBe('status');body={ok:true};}
 else if(path.endsWith('/get_partner_program'))body=program;
 else if(path.endsWith('/validate_partner_code'))body={valid:true};
 else if(path.endsWith('/apply_partner')){const p=route.request().postDataJSON();expect(p._business).toBe('Synthetic Hotel');expect(p._phone).toBe('3055550101');applied=true;body='p1';}
 else if(path.endsWith('/get_partner_dashboard'))body={partner,tier:'Bronze',rate_bps:300,completed:0,bookings:[]};
 else if(path.includes('/functions/'))throw Error('Partner UI must not invoke payment or email functions');
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto('/partners?ref=ZXTEST12345678');await expect(page.getByRole('heading',{name:'Your Guests Drive. You Earn.'})).toBeVisible();
 await expect(page.getByText('Higher-tier qualification thresholds are under review;', {exact:false})).toBeVisible();
 await page.getByLabel('Full name',{exact:true}).fill('Test Concierge');await page.getByLabel('Business name',{exact:true}).fill('Synthetic Hotel');await page.getByLabel('Phone',{exact:true}).fill('3055550101');await page.getByRole('button',{name:'Submit application',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Application received.'})).toBeVisible();expect(applied).toBe(true);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zonyx-partner-referral-v1')||'null').code)).toBe('ZXTEST12345678');
 await page.goto('/partners/dashboard');await expect(page.getByRole('heading',{name:'Your ZONYX partnership'})).toBeVisible();await expect(page.getByLabel('Your referral URL')).toHaveValue('https://www.gozonyx.com/?ref=ZXTEST12345678');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.goto('/admin-dashboard');await page.getByRole('tab',{name:'Partners',exact:true}).click();await expect(page.getByRole('heading',{name:'Partner Program',exact:true})).toBeVisible();await expect(page.getByText('Synthetic Hotel',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Suspend',exact:true}).click();await expect(page.getByRole('button',{name:'Export payout ledger',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
