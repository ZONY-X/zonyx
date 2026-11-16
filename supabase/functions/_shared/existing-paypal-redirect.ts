const DESTINATION='https://www.paypal.com/ncp/payment/DZY2WXFF5XS8L';
export const ACCEPTANCE_WORDING='I am the cardholder or authorized user and authorize future charges under these Terms and accept the Rental Agreement.';
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
export function existingPayPalRedirect(db:any){
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,authorization,content-type,x-client-info'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 return async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Method not allowed.'});
  try{
   const raw=await request.text();if(raw.length>10000)return reply(413,{error:'Invalid payment-link request.'});
   const input=JSON.parse(raw);
   const allowed:Record<string,string[]>={details:['action','token'],status:['action','token'],'accept-and-redirect':['action','token','agreementAccepted','agreementHash','payerName','payerEmail','postalCode','submissionId']};
   if(!input||typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token)||!allowed[input.action]||Object.keys(input).some(k=>!allowed[input.action].includes(k)))return reply(400,{error:'Invalid payment-link request.'});
   const {data:c,error}=await db.from('existing_paypal_link_contexts').select('*').eq('token_hash',await sha(input.token)).maybeSingle();
   if(error)return reply(503,{error:'Payment record unavailable.'});
   if(!c||!c.enabled)return reply(404,{error:'Payment link unavailable.'});
   if(c.payment_id!=='835e0865-7701-4b9d-86bc-6d617c2d9bc0'||c.destination!==DESTINATION||c.snapshot.amountCents!==375000||c.snapshot.currency!=='USD'||c.agreement_hash!==c.snapshot.agreement.hash||await sha(c.snapshot.agreement.text)!==c.agreement_hash)return reply(409,{error:'Payment reference could not be verified.'});
   const details={...c.snapshot,tokenHash:undefined,provider:'paypal',environment:'live',checkoutMode:'hosted_redirect',state:'awaiting_approval',reviewOnly:false,testOnly:false,captureEnabled:false,canPay:true};
   if(input.action==='details'||input.action==='status')return reply(200,details);
   if(input.agreementAccepted!==true||input.agreementHash!==c.agreement_hash||typeof input.payerName!=='string'||input.payerName.trim().length<2||input.payerName.length>160||typeof input.payerEmail!=='string'||input.payerEmail.length>254||!/^\S+@\S+\.\S+$/.test(input.payerEmail)||typeof input.postalCode!=='string'||input.postalCode.trim().length<2||input.postalCode.length>16||typeof input.submissionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.submissionId))return reply(400,{error:'Review the Rental Agreement and cardholder details.'});
   const result=await db.rpc('accept_existing_paypal_link',{_payment_id:c.payment_id,_submission_id:input.submissionId,_agreement_hash:input.agreementHash,_payer_name:input.payerName.trim(),_payer_email:input.payerEmail.trim().toLowerCase(),_postal_code:input.postalCode.trim(),_wording:ACCEPTANCE_WORDING,_user_agent:(request.headers.get('user-agent')||'').slice(0,500)});
   if(result.error||!result.data?.accepted_at)return reply(409,{error:'Rental Agreement acceptance could not be recorded. No payment was started.'});
   return reply(200,{paymentId:c.payment_id,acceptanceId:result.data.id,acceptedAt:result.data.accepted_at,url:DESTINATION});
  }catch{return reply(400,{error:'Invalid payment-link request.'});}
 };
}
