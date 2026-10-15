import { EARLY_TERMINATION_CLAUSE, RENTAL_AGREEMENT_MASTER_ID, RENTAL_AGREEMENT_VERSION, RENTAL_AGREEMENT_V1_5 } from '../../../src/lib/rentalAgreementV1_5.ts';
export const sha256 = async (text:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
type Reader={from:(table:string)=>any};
// Existing signed bytes remain immutable. New terms are separately accepted.
export async function loadPaymentRentalAgreement(db:Reader,bookingId:string){
 const {data:original,error:ae}=await db.from('booking_rental_agreements').select('id,master_version,rendered_text,document_hash,accepted_at,guest_auth_user_id').eq('booking_id',bookingId).single();
 if(ae||!original?.accepted_at)throw Error('Accepted Rental Agreement unavailable.');
 const {data:pointer,error:pe}=await db.from('rental_agreement_current_revisions').select('revision_id').eq('booking_id',bookingId).maybeSingle();
 if(pe)throw Error('Current Rental Agreement unavailable.');
 let source={id:null as string|null,rendered_text:original.rendered_text,document_hash:original.document_hash};
 if(pointer){const {data:revision,error:re}=await db.from('rental_agreement_revisions').select('id,rendered_text,document_hash').eq('id',pointer.revision_id).single();if(re||!revision)throw Error('Current Rental Agreement revision unavailable.');source=revision;}
 const {data:master,error:me}=await db.from('rental_agreement_versions').select('id,version,canonical_body,content_hash,status').eq('id',RENTAL_AGREEMENT_MASTER_ID).single();
 if(me||master?.status!=='published'||master.version!==RENTAL_AGREEMENT_VERSION||master.canonical_body!==RENTAL_AGREEMENT_V1_5||master.content_hash!==await sha256(RENTAL_AGREEMENT_V1_5))throw Error('Published Rental Agreement verification unavailable.');
 const isAddendum=!source.rendered_text.includes(EARLY_TERMINATION_CLAUSE);
 const renderedText=isAddendum?`ZONYX RENTAL AGREEMENT ADDENDUM — v${master.version}\n\nReservation ID: ${bookingId}\nOriginal Agreement ID: ${original.id}\nOriginal signed version: ${original.master_version}\nSource document hash: ${source.document_hash}\n\nThis addendum supplements the existing signed Rental Agreement only upon your explicit electronic acceptance. All other existing contractual provisions remain unchanged. The clause applies only to reservations of 60 days or longer. No charge or deposit forfeiture occurs by accepting this addendum. Recoveries must not duplicate amounts already recovered for the same loss.\n\n${EARLY_TERMINATION_CLAUSE}\n\n⸻\n\nCOMPLETE EXISTING RENTAL AGREEMENT (PRESERVED)\n\n${source.rendered_text}`:source.rendered_text;
 return {version:master.version,version_id:master.id,master_hash:master.content_hash,document_hash:await sha256(renderedText),rendered_text:renderedText,booking_id:bookingId,agreement_id:original.id,guest_auth_user_id:original.guest_auth_user_id,source_revision_id:source.id,source_revision_hash:source.document_hash,is_addendum:isAddendum};
}
