import {test,expect,type Page} from '@playwright/test';
const user={id:'11111111-1111-4111-8111-111111111111',email:'synthetic@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
async function fixture(page:Page) {
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.route('**auth-fixture.supabase.co/**',r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/signup'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)});
  if(path.endsWith('/token'))return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error_code:'email_not_confirmed',msg:'Email not confirmed'})});
  return r.fulfill({status:200,contentType:'application/json',body:'[]'});
 });
}
for (const width of [390, 1280]) {
 test(`signup verification and resend at ${width}px`, async ({page}) => {
  await fixture(page); await page.setViewportSize({width,height:844});
  await page.goto('/auth?mode=signup&redirectTo=%2Fbooking%2Ftest%3Fstart%3D2026-12-01');
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-123!');
  await page.getByRole('button',{name:'Sign Up',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Account created! Please check your email and click the verification link to activate your account.'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Resend verification email/})).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zonyx-auth-return')!).path)).toBe('/booking/test?start=2026-12-01');
  await page.getByRole('button',{name:'Back to Sign In'}).click();
  await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-123!');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.getByText(/Please verify your email before signing in/)).toBeVisible();
 });
}
test('resend uses signup endpoint and safe origin redirect', async ({page}) => {
 await fixture(page); await page.goto('/auth');
 await page.getByLabel('Email',{exact:true}).fill(user.email);
 await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-123!');
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
 const request = page.waitForRequest(r=>r.url().includes('/resend'));
 await page.getByRole('button',{name:'Resend verification email',exact:true}).click();
 const sent=await request;
 expect(sent.postDataJSON()).toMatchObject({type:'signup',email:user.email});
 expect(sent.url()).toContain('redirect_to=http%3A%2F%2F127.0.0.1%3A43878');
 await expect(page.getByText(/If this address needs verification/)).toBeVisible();
 await expect(page.getByRole('button',{name:/Resend verification email/})).toBeDisabled();
});
test('signup verification token is not routed to password reset', async ({page}) => {
 await fixture(page); await page.goto('/auth#type=signup&error_code=otp_expired');
 await expect(page).toHaveURL(/\/auth/);
 await expect(page.getByText(/Your verification link could not be used/)).toBeVisible();
});

function sessionFixture() {
 const expiresAt = Math.floor(Date.now()/1000)+3600;
 const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,exp:expiresAt,role:'authenticated'})}.signature`;
 return {access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:expiresAt,token_type:'bearer',user};
}
test('verification link establishes a session and resumes the stored booking target',async({page})=>{
 await fixture(page);
 const session=sessionFixture();
 await page.addInitScript(()=>localStorage.setItem('zonyx-auth-return',JSON.stringify({path:'/fleet?start=2026-12-01&end=2026-12-03&pickupTime=13%3A00',expires:Date.now()+86400000})));
 await page.route('**auth-fixture.supabase.co/auth/v1/user',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)}));
 await page.goto(`/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=signup`);
 await expect(page).toHaveURL(/\/fleet\?start=2026-12-01&end=2026-12-03&pickupTime=13%3A00/);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sb-auth-fixture-auth-token')!).user.id)).toBe(user.id);
});
test('confirmed sign-in resumes booking context',async({page})=>{
 await fixture(page);
 await page.route('**auth-fixture.supabase.co/auth/v1/token**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(sessionFixture())}));
 await page.goto('/auth?redirectTo=%2Ffleet%3Fstart%3D2026-12-01');
 await page.getByLabel('Email',{exact:true}).fill(user.email);
 await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-123!');
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page).toHaveURL(/\/fleet\?start=2026-12-01/);
});
test('an arbitrary invalid password retains generic errors without an account lookup',async({page})=>{
 await fixture(page);
 await page.route('**auth-fixture.supabase.co/auth/v1/token**',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error_code:'invalid_credentials',msg:'Invalid login credentials'})}));
 await page.goto('/auth?redirectTo=%2F%5Cevil.example');
 await page.getByLabel('Email',{exact:true}).fill(user.email);
 await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-123!');
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page.getByText('Invalid email or password. Please try again.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zonyx-auth-return')!).path)).toBe('/dashboard');
});
test('password recovery continues to use its dedicated screen',async({page})=>{
 await fixture(page);await page.goto('/auth#type=recovery&error_code=otp_expired');
 await expect(page).toHaveURL(/\/reset-password/);
});

test('trip selections survive registration and verification, without accepting terms or submitting payment',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});
 const vehicleId='3b8770f4-f2a5-4c24-846f-d5b856742065';
 const vehicle={id:vehicleId,host_profile_id:user.id,vehicle_identifier:'ZONYX-CT-AWD-001',brand:'Tesla',name:'Cybertruck AWD',model:'Cybertruck AWD',category:'Electric Pickup',color:'Silver',year:2026,base_daily_rate_cents:17500,minimum_rental_hours:24,image_url:'/placeholder.svg',images:['/placeholder.svg'],seats:5,transmission:'automatic',fuel_type:'Electric',is_active:true,availability_status:'active',description:null};
 let paymentRequests=0;
 await page.route('**auth-fixture.supabase.co/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  let body:unknown;
  if(path.includes('/vehicles'))body=vehicle;
  else if(path.endsWith('/calculate_rental_days'))body=3;
  else if(path.endsWith('/check_vehicle_availability'))body=true;
  else if(path==='/auth/v1/user')body=user;
  else if(path.includes('/functions/')) {paymentRequests++;body={};}
  else return r.fallback();
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(`/booking/${vehicleId}?start=2038-12-01&end=2038-12-04&pickupLocation=Brickell`);
 await page.getByLabel('Pickup time',{exact:true}).fill('14:30');
 await page.getByLabel('Drop-off time',{exact:true}).fill('16:00');
 await page.getByRole('button',{name:'ZONYX Rental Agreement',exact:true}).click();
 await expect(page).toHaveURL(/\/auth\?/);
 const target=new URL(page.url()).searchParams.get('redirectTo')!;
 expect(new URL(target,'http://localhost').searchParams.get('pickupTime')).toBe('14:30');
 expect(new URL(target,'http://localhost').searchParams.get('dropoffTime')).toBe('16:00');
 await page.getByRole('tab',{name:'SIGN UP',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(user.email);
 await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-123!');
 await page.getByRole('button',{name:'Sign Up',exact:true}).click();
 await expect(page.getByText(/Account created! Please check your email/)).toBeVisible();
 const session=sessionFixture();
 await page.goto(`/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=signup`);
 await expect(page.getByLabel('Pickup time',{exact:true})).toHaveValue('14:30');
 await expect(page.getByLabel('Drop-off time',{exact:true})).toHaveValue('16:00');
 await expect(page.getByLabel('Pickup location',{exact:true})).toHaveValue('Brickell');
 expect(paymentRequests).toBe(0);
});
