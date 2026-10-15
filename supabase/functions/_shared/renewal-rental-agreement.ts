import {loadPaymentRentalAgreement,sha256} from './payment-rental-agreement.ts';
export {sha256};
export const RENEWAL_AGREEMENT_CONSENT='I am the cardholder or authorized user and authorize future charges under these Terms and accept the Rental Agreement and its Early Termination Addendum.';
type Reader={from:(table:string)=>any};
export async function loadRenewalRentalAgreement(db:Reader,details:Record<string,unknown>){
 const {data:period,error}=await db.from('rental_extension_periods').select('id,booking_id,period_start,period_end').eq('id',details.period_id).single();
 if(error||!period)throw Error('Renewal agreement reservation unavailable.');
 const agreement=await loadPaymentRentalAgreement(db,period.booking_id);
 const renderedText=`RENEWAL AGREEMENT REVIEW\nReservation: ${details.reservation_number}\nRenewal period: ${period.period_start} → ${period.period_end}\n\n${agreement.rendered_text}`;
 return {...agreement,rendered_text:renderedText,document_hash:await sha256(renderedText),period_id:period.id,consent_text:agreement.is_addendum?RENEWAL_AGREEMENT_CONSENT:RENEWAL_AGREEMENT_CONSENT.replace(' and its Early Termination Addendum','')};
}
