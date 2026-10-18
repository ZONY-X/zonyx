import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
const user={id:'11111111-1111-4111-8111-111111111111',email:'admin@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const fixture=process.env.OPERATIVE_AGREEMENT_FIXTURE?JSON.parse(readFileSync(process.env.OPERATIVE_AGREEMENT_FIXTURE,'utf8')):{id:'agreement',booking_id:'booking',reservation_number:'SYNTHETIC',master_version:'1.2',accepted_at:'2026-09-20T12:00:00Z',agreement_effective_at:'2026-09-20T12:00:00Z',trip_financial_summary:{},document_hash:'a'.repeat(64),original_document_hash:'b'.repeat(64),rendered_text:'Historical source with original period and $1,537.00.',current_revision:{id:'revision',revision_number:4,effective_at:'2026-10-13T12:00:00Z',field_changes:[],operative_state:{},reason:'Existing extension',document_hash:'a'.repeat(64)},operative_renewal:{extension_start_date:'2026-10-21',return_date:'2027-01-21',return_time:'10:00:00',original_start_date:'2026-09-21',original_end_date:'2026-10-21',original_amount_cents:153700,currency:'usd',source_revision_id:'revision',source_revision_hash:'a'.repeat(64),periods:[{id:'period',period_start:'2026-10-21',period_end:'2026-11-21',amount_cents:158400,currency:'usd',payment_status:'paid',paid_at:'2026-10-16T18:37:48Z',verified_square_payment_id:'synthetic-payment'},{id:'next',period_start:'2026-11-21',period_end:'2026-12-21',amount_cents:158400,currency:'usd',payment_status:'scheduled',paid_at:null,verified_square_payment_id:null}],accepted_renewal:{id:'consent',version:'1.6',accepted_at:'2026-10-16T18:37:45Z',document_hash:'c'.repeat(64),rendered_text:'ZONYX TRIP RENTAL AGREEMENT\n\nRecorded accepted terms.\n\n⸻\n\n1. EXISTING TERMS\n\nThese accepted terms remain unchanged.\n\nELECTRONIC ACCEPTANCE RECORD',consent_text:'I accept the Rental Agreement.'}}};
for(const width of [1280,390])test(`current agreement and PDF ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});const expires=Math.floor(Date.now()/1000)+3600,encode=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');const session={user,access_token:encode({alg:'HS256'})+'.'+encode({sub:user.id,exp:expires,role:'authenticated'})+'.fixture',refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer'};
 await page.addInitScript(s=>localStorage.setItem('sb-fazzuetfwwfiqehpnjky-auth-token',JSON.stringify(s)),session);let mutations=0;
 await page.route('**fazzuetfwwfiqehpnjky.supabase.co/**',async route=>{const path=new URL(route.request().url()).pathname;let body:unknown=[];
 if(path==='/auth/v1/user')body=user;
 else if(path.endsWith('/rpc/get_booking_rental_agreement'))body=fixture;
 else if(path.endsWith('/rpc/get_my_pending_rental_agreement_amendment'))body=null;
 else if(path.includes('/profiles'))body={id:'profile',is_admin:true};
 else if(path.includes('capabilities'))body=[];
 else if(path.includes('/functions/')){mutations++;return route.abort();}
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto('/booking/'+fixture.booking_id+'/agreement');
 await expect(page.getByRole('heading',{name:'ZONYX CURRENT OPERATIVE RENTAL AGREEMENT',exact:true})).toBeVisible();
 await expect(page.getByText('Verified renewal payment: $1,584.00 USD',{exact:false})).toBeVisible();
 await expect(page.getByText('Renewal / extension term: October 21, 2026 – January 21, 2027',{exact:false})).toBeVisible();
 await expect(page.getByText('Payment covers: October 21, 2026 – November 21, 2026',{exact:false})).toBeVisible();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download Current Operative Agreement',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/revision-4\.pdf$/);const path=await download.path();const bytes=readFileSync(path!);expect(bytes.subarray(0,5).toString()).toBe('%PDF-');const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBeGreaterThan(0);expect(mutations).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
