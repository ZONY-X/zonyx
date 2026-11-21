// Fresh browser, real application; intercepted Auth, REST and processor boundaries.
// Real SQL/handler account lifecycle is separately tested by test-guest-account-lifecycle.mjs.
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const vehicleId='33333333-3333-4333-8333-333333333333',bookingId='44444444-4444-4444-8444-444444444444',agreementId='55555555-5555-4555-8555-555555555555';
const guestId='11111111-1111-4111-8111-111111111111',permanentId='22222222-2222-4222-8222-222222222222';
const vehicle={id:vehicleId,host_profile_id:permanentId,slug:'tesla-model-3',vehicle_identifier:'ZONYX-M3-001',brand:'Tesla',name:'Model 3',model:'Model 3',category:'Electric Sedan',color:'White',year:2026,base_daily_rate_cents:10000,minimum_rental_hours:24,image_url:'/placeholder.svg',images:['/placeholder.svg'],seats:5,transmission:'automatic',fuel_type:'Electric',is_active:true,availability_status:'active',vin:'SYNTHETIC',plate:'TEST',description:'Synthetic rental fixture'};
for(const width of [1440,390])test(`Fresh guest checkout and later account activation (${width}px)`,async({page})=>{
 const email=`new-guest-${randomUUID()}@example.invalid`;
 let user:any=null,contact:any,accepted=false,paid=false,hold=false,activated=false,permanent=false;
 const calls:Array<{path:string;body:any}>=[];
 const authUser=(anonymous:boolean)=>({id:anonymous?guestId:permanentId,is_anonymous:anonymous,email:anonymous?undefined:email,email_confirmed_at:anonymous?undefined:new Date().toISOString(),aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()});
 const session=(u:any)=>{const enc=(v:any)=>Buffer.from(JSON.stringify(v)).toString('base64url');const exp=Math.floor(Date.now()/1000)+3600;return{access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:u.id,exp,role:'authenticated',is_anonymous:u.is_anonymous})}.synthetic`,refresh_token:'synthetic-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user:u}};
 await page.setViewportSize({width,height:1000});
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('https://sandbox.web.squarecdn.com/v1/square.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Square={payments:()=>({card:async()=>({attach:async h=>{h.textContent='Synthetic secure card form'},destroy:async()=>{},tokenize:async()=>({status:'OK',token:'cnon:synthetic-card'})})})};`}));
 await page.route('**guest-fixture.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const input=req.postData()?req.postDataJSON():{};calls.push({path,body:input});let body:any=[],status=200;
  if(path==='/auth/v1/signup'){
   expect(input).not.toHaveProperty('email');expect(input).not.toHaveProperty('password');expect(input).not.toHaveProperty('phone');
   user=authUser(true);body=session(user);
  }else if(path==='/auth/v1/user'){
   if(req.method()==='PUT'){expect(activated).toBe(true);expect(input.password).toBeTruthy();}
   body=user;
  }else if(path==='/auth/v1/otp'){
   expect(paid&&hold).toBe(true);expect(input.email).toBe(email);expect(input.create_user).toBe(false);body={};
  }else if(path.includes('/rest/v1/vehicles'))body=req.headers().accept?.includes('object')?vehicle:[vehicle];
  else if(path.includes('/rest/v1/profiles'))body={id:permanentId,is_admin:false,is_internal_tester:false};
  else if(path.includes('/rest/v1/bookings'))body={grand_total_cents:12000,currency:'usd'};
  else if(path.includes('/rest/v1/booking_payments'))body=null;
  else if(path.endsWith('/rpc/calculate_rental_days'))body=1;
  else if(path.endsWith('/rpc/check_vehicle_availability'))body=true;
  else if(path.endsWith('/rpc/get_my_account_capabilities'))body=[{profile_id:permanentId,can_guest:true,can_host:false,can_admin:false}];
  else if(path.endsWith('/rpc/submit_my_driver_eligibility'))body='eligible_self_attested';
  else if(path.endsWith('/rpc/get_my_driver_eligibility'))body=[{status:'eligible_self_attested',legal_name:'New Guest Driver'}];
  else if(path.endsWith('/functions/v1/guest-account')){
   if(input.action==='contact'){expect(user?.is_anonymous).toBe(true);expect(input.email).toBe(email);contact=input;body={saved:true};}
   if(input.action==='status')body={confirmed:paid&&hold,invitationSent:permanent};
   if(input.action==='bookings'){expect(activated).toBe(true);body={bookings:[{id:bookingId,reference:'ZNX-SYNTHETIC',vehicle:'2026 Tesla Model 3',startDate:'2038-09-30',endDate:'2038-10-01',tripStatus:'confirmed',totalCents:12000,currency:'usd'}]};}
  }else if(path.endsWith('/functions/v1/rental-agreement')){
   expect(contact?.email).toBe(email);expect(user.is_anonymous).toBe(true);
   if(input.action==='accept'){expect(input.termsAccepted&&input.rentalAgreementAccepted).toBe(true);accepted=true;body={bookingId,agreementId};}
   else body={agreementId,proposedBookingId:bookingId,masterVersion:'1.6',documentHash:'a'.repeat(64),renderedText:'ZONYX Rental Agreement\nGuest: New Guest Driver\nRental total: $120.00\nIdentity and license verification required before vehicle handover.',summary:{subtotal_cents:10000,service_fee_cents:1200,taxes_cents:800,final_total_cents:12000,currency:'usd',authorization_hold_amount_cents:50000,mileage_calculation_method:'per_day_non_cumulative',included_mileage_allowance:75,additional_mile_rate_cents:100,authorized_drivers:[]}};
  }else if(path.endsWith('/functions/v1/square-checkout')){
   expect(accepted).toBe(true);expect(input).not.toHaveProperty('amount');
   if(input.action==='config')body={applicationId:'synthetic',locationId:'synthetic',amountCents:12000,depositAmountCents:50000,existingPayment:null};
   if(input.action==='hold'){hold=true;body={paymentId:'synthetic-payment',state:'creating',depositStatus:'authorized',bookingConfirmed:false};}
   if(input.action==='rental'){expect(hold).toBe(true);paid=true;body={paymentId:'synthetic-payment',state:'paid',depositStatus:'authorized',bookingConfirmed:true};}
  }else if(path.endsWith('/functions/v1/booking-conversion')){expect(paid&&hold).toBe(true);body={bookingConfirmed:true,paymentSummary:{value:120,currency:'USD'},purchase:null};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/fleet');
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.endsWith('auth-token')))).toEqual([]);
 await expect(page.getByRole('link',{name:'View Details',exact:true}).first(),JSON.stringify(calls)).toBeVisible({timeout:5000}).catch(async e=>{console.log(await page.locator('body').innerText());console.log(calls);throw e;});
 await page.getByRole('link',{name:'View Details',exact:true}).first().click();
 await page.getByRole('link',{name:/Check availability/}).first().click();
 await expect(page).toHaveURL(new RegExp(`/booking/${vehicleId}`));
 await page.locator('input[type=date]').nth(0).fill('2038-09-30');
 await page.locator('input[type=date]').nth(1).fill('2038-10-01');
 await page.getByLabel('Full legal name').fill('New Guest Driver');
 await page.getByLabel('Email for your booking').fill(email);
 await page.getByLabel('Contact phone').fill('+1 305 555 0123');
 await page.getByLabel('Date of birth').fill('1990-01-01');
 await page.getByLabel('License issuing country').fill('US');
 await page.getByLabel('License issuing state/region').fill('FL');
 await page.getByLabel('License expiration').fill('2040-01-01');
 await page.getByLabel(/I attest/).check();
 await page.getByRole('checkbox',{name:'Review the booking-specific ZONYX Rental Agreement'}).click();
 await expect(page.getByRole('dialog')).toContainText('New Guest Driver');
 await page.getByRole('button',{name:'Accept This Rental Agreement'}).click();
 await expect(page.getByRole('dialog')).not.toBeVisible();
 const terms=page.getByLabel(/I agree to the ZONYX Terms/);
 await terms.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
 await terms.check();
 await page.getByRole('button',{name:'Continue to secure payment',exact:true}).click();
 await expect(page).toHaveURL(/\/booking\/square\?/);
 await expect(page.locator('input[type=password]')).toHaveCount(0);
 await page.getByRole('button',{name:'Pay',exact:true}).click();
 await page.getByRole('button',{name:'Pay',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Booking Confirmed',exact:true})).toBeVisible();
 expect(calls.filter(c=>c.path==='/auth/v1/signup')).toHaveLength(1);
 expect(calls.some(c=>c.path==='/auth/v1/token'||c.path==='/auth/v1/verify')).toBe(false);
 expect(calls.filter(c=>c.body.action==='rental')).toHaveLength(1);
 await page.screenshot({path:`../../outputs/guest-confirmation-${width}.png`,fullPage:true});
 // The independent post-payment worker is covered against real SQL separately.
 permanent=true;
 await page.goto('/booking/access');
 await page.getByLabel('Booking email').fill(email);
 await page.getByRole('button',{name:'Email secure access link'}).click();
 await expect(page.getByRole('status')).toContainText('secure link will arrive');
 user=authUser(false);activated=true;const verifiedSession=session(user);
 await page.goto(`/booking/access#access_token=${verifiedSession.access_token}&refresh_token=synthetic-refresh&expires_in=3600&token_type=bearer&type=magiclink`);
 await page.reload(); // Email redirects create a fresh document before Auth reads the fragment.
 await expect(page.getByText('Reference: ZNX-SYNTHETIC')).toBeVisible();
 await page.getByText('Set or change your password (optional)').click();
 await page.getByLabel('New password').fill('Synthetic-Only-Password-123');
 await page.getByRole('button',{name:'Save password',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Your password has been saved');
 expect(calls.filter(c=>c.path==='/auth/v1/signup')).toHaveLength(1);
 await page.screenshot({path:`../../outputs/guest-account-${width}.png`,fullPage:true});
});
