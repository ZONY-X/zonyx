import { test, expect } from '@playwright/test';
for (const scenario of ['extend', 'edit', 'conflict', 'stale'] as const) test(`Admin reservation ${scenario}`, async ({ page }) => {
 const calls: string[] = [];
 const apiRef = process.env.ADMIN_UI_BASE_URL ? 'fazzuetfwwfiqehpnjky' : 'admin-fixture';
 const appHost = new URL(process.env.ADMIN_UI_BASE_URL || 'http://127.0.0.1:43878').hostname;
 const user = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
 let booking = { id: '22222222-2222-4222-8222-222222222222', reservation_number: 'SYNTHETIC-RESERVATION', vehicle_id: 'vehicle-fixture', host_profile_id: 'admin-profile', renter_profile_id: 'guest-profile', start_date: '2098-06-01', pickup_time: '10:00:00', end_date: '2098-06-02', dropoff_time: '10:00:00', trip_status: 'confirmed', currency: 'usd', original_booking_total_cents: 12000, displayed_total_cents: 12000, subtotal_cents: 10000, service_fee_cents: 1200, taxes_cents: 800, vehicle_brand: 'Synthetic', vehicle_model: 'Vehicle', renter_name: 'Synthetic Guest', renter_email: 'guest@example.invalid' };
 let history: unknown[] = [];
 let total = 12000;
 await page.addInitScript(({user,apiRef}) => { const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); const exp = Math.floor(Date.now()/1000)+3600; localStorage.setItem(`sb-${apiRef}-auth-token`, JSON.stringify({access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp,role:'authenticated'})}.synthetic`,refresh_token:'synthetic',expires_at:exp,expires_in:3600,token_type:'bearer',user})); localStorage.setItem('zonyx-account-mode', 'admin'); }, {user,apiRef});
 await page.route('**/*', route => ['127.0.0.1', 'localhost', appHost].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
 await page.route(`**${apiRef}.supabase.co/**`, async route => {
   const path = new URL(route.request().url()).pathname;
   const input = route.request().postData() ? route.request().postDataJSON() : {};
   let body: unknown = []; let status = 200;
   if (path.includes('/auth/v1/user')) body = user;
   if (path.endsWith('get_my_account_capabilities')) body = [{profile_id:'admin-profile',can_guest:true,can_host:true,can_admin:true,can_operations:false}];
   if (path.endsWith('get_booking_operational_read_model')) body = [booking];
   if (path.endsWith('get_accessible_booking_rental_agreement_ids')) body = [];
   if (path.endsWith('/profiles')) body = [{id:'admin-profile',is_admin:true,full_name:'Synthetic Admin'}];
   if (path.endsWith('get_my_platform_capabilities')) body = [];
   if (path.endsWith('admin_get_reservation_changes')) body = {booking,updated_total_cents:total,adjustments_cents:total-12000,outstanding_balance_cents:total-12000,credit_balance_cents:0,payment_collection_supported:false,history};
   if (path.endsWith('admin_preview_reservation_change')) {
     calls.push('preview');
     if (scenario === 'conflict') { status=400; body={message:'Vehicle is not available: the selected dates overlap another reservation.'}; }
     else body = {booking_id:booking.id,action:input._action,before:{start_date:booking.start_date,pickup_time:booking.pickup_time,end_date:booking.end_date,dropoff_time:booking.dropoff_time},after:{start_date:input._start_date,pickup_time:input._pickup_time,end_date:input._end_date,dropoff_time:input._dropoff_time},current_rental_days:1,new_rental_days:scenario==='edit'?1:2,additional_rental_days:scenario==='edit'?0:1,extension_hours:24,daily_rate_cents:10000,adjustment_cents:scenario==='edit'?0:12000,additional_charges_cents:scenario==='edit'?0:12000,credit_cents:0,current_total_cents:12000,updated_total_cents:scenario==='edit'?12000:24000,outstanding_adjustments_cents:scenario==='edit'?0:12000,currency:'usd',pricing_source:'Accepted reservation rate.',version:'fixture-version'};
   }
   if (path.endsWith('admin_save_reservation_change')) {
     calls.push('save');
     expect(input._booking_id).toBe(booking.id);expect(input._expected_quote.version).toBe('fixture-version');expect(input._reason.length).toBeGreaterThan(5);
     if (scenario==='stale') {status=400;body={message:'Reservation or pricing changed. Review the updated price before saving.'};}
     else {const before={...booking};booking={...booking,start_date:input._start_date,pickup_time:input._pickup_time,end_date:input._end_date,dropoff_time:input._dropoff_time};total=scenario==='edit'?12000:24000;history=[{id:'change-fixture',action:input._action,before,after:booking,adjustment_cents:total-12000,reason:input._reason,admin_name:'Synthetic Admin',actor_profile_id:'admin-profile',created_at:'2098-06-01T10:00:00Z',renewal_period_id:total>12000?'period-fixture':null,payment_status:'payment_due',paid_at:null}];body={booking_id:booking.id};}
   }
   if(path.includes('/functions/v1/')) { calls.push('external-payment');status=500;body={error:'No financial action is permitted in this test.'}; }
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/admin-dashboard');
 await page.getByRole('button', {name:'Booking actions'}).click();
 await page.getByRole('menuitem', {name:'View details',exact:true}).click();
 await page.getByRole('button',{name:scenario==='edit'?'Edit Reservation':'Extend Reservation',exact:true}).click();
 await page.getByLabel('Return date',{exact:true}).fill(scenario==='edit'?'2098-06-02':'2098-06-03');
 if(scenario==='edit') {await page.getByLabel('Pickup time',{exact:true}).fill('11:00');await page.getByLabel('Return time',{exact:true}).fill('11:00');}
 await page.getByLabel('Reason for change').fill('Synthetic admin test reason');
 await page.getByRole('button',{name:'Review Changes',exact:true}).click();
 if(scenario==='conflict') {await expect(page.getByRole('alert')).toContainText('overlap');await expect(page.getByRole('button',{name:'Confirm Extension',exact:true})).toHaveCount(0);expect(calls).toEqual(['preview']);return;}
 await expect(page.getByRole('region',{name:'Reservation price preview'})).toContainText(scenario==='edit'?'$120.00':'$240.00');
 await page.getByRole('button',{name:scenario==='edit'?'Save Changes':'Confirm Extension',exact:true}).click();
 if(scenario==='stale') {await expect(page.getByRole('alert')).toContainText('Review the updated price');return;}
 await expect(page.getByText('Reason: Synthetic admin test reason')).toBeVisible();
 if(scenario!=='edit') await expect(page.getByText('Additional payment: payment due')).toBeVisible();
 expect(calls).toEqual(['preview','save']);
});
