import {SquareClient} from './square-client.ts';
import {squareRenewalEvidence,type RenewalAttempt} from './square-renewal.ts';
import type {SquarePayment} from './square-policy.ts';
export const CARD_TERMS_VERSION='zonyx-square-cof-v1';
export type Payer={givenName:string;familyName:string;email:string;postalCode:string;country:string};
export type Authorization={id:string;attempt_id:string;submission_id:string;booking_id:string|null;test_id:string|null;payer_given_name:string;payer_family_name:string;payer_email:string;postal_code:string;country:string;square_customer_id:string|null;square_card_id:string|null;card_state:string;card_last4:string|null;card_brand:string|null;state:string;management_token:string;terms_text:string;accepted_at:string;withdrawn_at:string|null;dispatch_started_at:string|null};
// Structural boundary keeps the payment helpers unit-testable without a network SDK.
export type CardDB={from:(name:string)=>{select:(columns:string)=>{eq:(name:string,value:string)=>{maybeSingle:()=>Promise<{data:Authorization|null;error:unknown}>}};update:(fields:Record<string,unknown>)=>{eq:(name:string,value:string)=>PromiseLike<{error:unknown}>}};rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
export function authorizationTerms(liveTest:boolean){
 const scope=liveTest?'This is an independent $1.00 LIVE Square test, not a rental payment. It does not pay, modify, or authorize charges for ZNX-000150 or any other existing reservation. Future rental charges require a separately accepted rental agreement and authorization linked to that reservation.':'This authorization applies only to the reservation shown on this checkout and its applicable rental agreement and disclosed rental schedule.';
 return `${scope} I authorize Square to securely save this card for ZONYX. I authorize ZONYX to use the saved card for subsequent rental periods and documented charges permitted by my applicable rental agreement, without requiring me to re-enter the card. Rental amounts and billing dates are determined by my accepted rental rates, renewal periods and billing schedule. Other permitted charges may include additional mileage, late return, charging, cleaning, tolls, parking or citations, damage, missing equipment, towing or recovery, and administrative fees only where permitted by that agreement. Such amounts must be itemized, supported by the agreement, and disclosed when due; this is not permission for unrelated or unspecified charges. No additional security-deposit hold will be created by this checkout. I can withdraw authorization for new payment instructions using the private management link provided after payment or by contacting support@gozonyx.com. Withdrawal does not cancel amounts already owed or payments already in progress. Square and my bank may require additional verification for a later charge. ZONYX does not store my full card number or CVV.`;
}
export function validatePayer(input:unknown):Payer{
 const p=input as Payer;
 if(!p||Object.keys(p).some(k=>!['givenName','familyName','email','postalCode','country'].includes(k)))throw new Error('Valid cardholder billing details are required.');
 const clean={givenName:String(p.givenName||'').trim(),familyName:String(p.familyName||'').trim(),email:String(p.email||'').trim().toLowerCase(),postalCode:String(p.postalCode||'').trim(),country:String(p.country||'').trim().toUpperCase()};
 if(!clean.givenName||clean.givenName.length>80||!clean.familyName||clean.familyName.length>80||!/^\S+@\S+\.\S+$/.test(clean.email)||clean.email.length>254||clean.postalCode.length<2||clean.postalCode.length>16||!/^[A-Z]{2}$/.test(clean.country))throw new Error('Enter your cardholder name, email, billing postal code and two-letter country code.');
 return clean;
}
export async function authorizationForAttempt(db:CardDB,attemptId:string){const {data,error}=await db.from('square_checkout_authorizations').select('*').eq('attempt_id',attemptId).maybeSingle();if(error)throw new Error('Card authorization lookup unavailable.');return data;}
export async function ensureSquareCustomer(db:CardDB,client:SquareClient,c:Authorization){
 let id=c.square_customer_id;
 if(!id){const created=await client.createCustomer({key:`cust-${c.id}`,reference:c.id,givenName:c.payer_given_name,familyName:c.payer_family_name,email:c.payer_email});id=created?.id;}
 if(!id)throw new Error('Square customer confirmation is pending. No payment was submitted.');
 const customer=await client.getCustomer(id);
 if(customer.id!==id||customer.reference_id!==c.id||customer.email_address?.toLowerCase()!==c.payer_email)throw new Error('Square customer identity conflicts. No payment was submitted.');
 const {error}=await db.from('square_checkout_authorizations').update({square_customer_id:id}).eq('id',c.id);if(error)throw new Error('Square customer persistence requires recovery. No payment was submitted.');
 return id;
}
export async function finalizeCheckoutCard(db:CardDB,client:SquareClient,a:RenewalAttempt,p:SquarePayment){
 const c=await authorizationForAttempt(db,a.id);if(!c||c.state==='withdrawn')return;
 squareRenewalEvidence(p,a);
 if(p.status!=='COMPLETED')return;
 const payment=p as SquarePayment&{customer_id?:string;card_details?:{card?:{last_4?:string}}};
 if(!c.square_customer_id||payment.customer_id!==c.square_customer_id)throw new Error('Payment customer does not match the recorded authorization.');
 let cardId=c.square_card_id;
 if(!cardId){const created=await client.saveCard({key:`card-${c.id}`,paymentId:p.id,customerId:c.square_customer_id,reference:c.id,name:`${c.payer_given_name} ${c.payer_family_name}`,postalCode:c.postal_code,country:c.country});cardId=created?.id;}
 if(!cardId)throw new Error('Square card storage is not yet confirmed. Do not pay again.');
 const card=await client.getCard(cardId);
 if(card.id!==cardId||!card.enabled||card.customer_id!==c.square_customer_id||card.reference_id!==c.id||!/^\d{4}$/.test(card.last_4||'')||(payment.card_details?.card?.last_4&&payment.card_details.card.last_4!==card.last_4))throw new Error('Square saved-card identity is not confirmed.');
 const {error}=await db.rpc('confirm_square_checkout_card',{_authorization_id:c.id,_customer_id:c.square_customer_id,_card_id:card.id,_last4:card.last_4,_brand:card.card_brand||'Card'});if(error)throw new Error('Saved-card authorization persistence needs recovery. Do not pay again.');
 const current=await authorizationForAttempt(db,a.id);if(current?.state==='withdrawn'){const disabled=await client.disableCard(card.id);if(disabled.enabled===false)await db.from('square_checkout_authorizations').update({card_state:'disabled'}).eq('id',c.id);}
}
export function merchantInitiatedPaymentInput(a:RenewalAttempt,c:Pick<Authorization,'square_card_id'|'square_customer_id'|'state'|'card_state'|'withdrawn_at'>){
 if(c.state!=='active'||c.card_state!=='verified'||c.withdrawn_at||!c.square_card_id?.startsWith('ccof:')||!c.square_customer_id)throw new Error('Active, verified Square card authorization required.');
 return {token:c.square_card_id,customerId:c.square_customer_id,key:a.id,reference:a.id,amount:a.amount_cents,hold:false,description:'ZONYX authorized rental renewal'};
}
