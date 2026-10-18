import type { ExecutedRentalAgreement } from './executedRentalAgreement';
export type OperativeRenewal = {
 projection_version:number;source_revision_id:string;source_revision_hash:string;extension_plan_id:string;
 extension_start_date:string;extension_start_time:string|null;return_date:string;return_time:string;
 original_start_date:string|null;original_end_date:string|null;original_amount_cents:number|null;currency:string;
 periods:Array<{id:string;period_number:number;period_start:string;period_end:string;amount_cents:number;currency:string;payment_status:string;paid_at:string|null;verified_square_payment_id:string|null}>;
 accepted_renewal:null|{id:string;period_id:string;version:string;version_id:string;accepted_at:string;document_hash:string;rendered_text:string;consent_text:string};
};
export const agreementMoney=(cents:number,currency:string)=>new Intl.NumberFormat('en-US',{style:'currency',currency:currency.toUpperCase()}).format(cents/100);
export const agreementDate=(date:string)=>new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
export function currentAgreementText(a:ExecutedRentalAgreement):string {
 const renewal=a.operative_renewal;if(!renewal?.extension_start_date||!renewal.return_date||!renewal.return_time)return a.rendered_text;
 const accepted=renewal.accepted_renewal;
 const paid=renewal.periods.filter(p=>p.payment_status==='paid'&&p.verified_square_payment_id);
 const lines=['ZONYX CURRENT OPERATIVE RENTAL AGREEMENT',`Reservation: ${a.reservation_number}`,`Operative revision: ${a.current_revision?.revision_number??'Not recorded'}`,'','CURRENT RENEWAL / EXTENSION TERMS',
  `Renewal / extension term: ${agreementDate(renewal.extension_start_date)} – ${agreementDate(renewal.return_date)}`,
  `Scheduled return: ${agreementDate(renewal.return_date)} at ${renewal.return_time.slice(0,5)} (Miami time)`,
  'Renewal start time: No separate start time is recorded in the accepted renewal. This continues the existing rental; it is not a new vehicle pickup.',
  '', 'RENEWAL PAYMENT SUMMARY'];
 for(const p of paid)lines.push(`Verified renewal payment: ${agreementMoney(p.amount_cents,p.currency)} ${p.currency.toUpperCase()}`,`Payment covers: ${agreementDate(p.period_start)} – ${agreementDate(p.period_end)}`,p.paid_at?`Payment recorded: ${new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(p.paid_at))} (Miami time)`:'Payment timestamp: Not recorded',`Square payment ID: ${p.verified_square_payment_id}`,'');
 if(!paid.length)lines.push('No verified Square renewal payment is recorded.');
 lines.push('The extension term and individual payment coverage are separate. A payment for one renewal period does not mark later periods paid.','','RENEWAL BILLING SCHEDULE');
 for(const p of renewal.periods)lines.push(`${agreementDate(p.period_start)} – ${agreementDate(p.period_end)} | ${agreementMoney(p.amount_cents,p.currency)} | ${p.verified_square_payment_id&&p.payment_status==='paid'?'Paid — verified with Square':p.payment_status==='paid'?'Payment verification unavailable':p.payment_status==='scheduled'?'Scheduled — not paid':'Not paid — '+p.payment_status.replaceAll('_',' ')}`);
 if(accepted){
  const summary=accepted.rendered_text.split('TRIP & FINANCIAL SUMMARY')[1]?.split('The information above forms part')[0]||'';
  const conditionLines=summary.split('\n').filter(line=>/^(Guest:|Vehicle:|Vehicle VIN:|Host \/ Vehicle Provider:|Security Deposit Authorization Hold:|Mileage:|Additional Mileage:|Primary Authorized Driver:|Additional Authorized Driver\(s\):|Damage Liability \/ Rental Vehicle Excess:|Reservation-Specific Protection:|Additional Booking-Specific Terms:)/.test(line));
  lines.push('','VEHICLE AND RECORDED RENTAL CONDITIONS',...conditionLines);
  if(a.current_revision?.operative_state.dropoff_location)lines.push('Return location: '+a.current_revision.operative_state.dropoff_location);

  const firstSeparator=accepted.rendered_text.indexOf('\n\n⸻\n\n');const end=accepted.rendered_text.indexOf('\n\nELECTRONIC ACCEPTANCE RECORD',firstSeparator);
  const legal=firstSeparator>=0?accepted.rendered_text.slice(firstSeparator+"\n\n⸻\n\n".length,end>=0?end:undefined):accepted.rendered_text;
  lines.push('','ACCEPTED RENTAL TERMS',`Accepted renewal agreement version: ${accepted.version}`,'',legal.trim());
 }else lines.push('','STORED OPERATIVE AGREEMENT',a.rendered_text);
 lines.push('','SOURCE RECORDS AND ACCEPTANCE EVIDENCE','This is a consolidated display of existing records, not a new agreement, amendment, signature, or acceptance.',`Stored operative revision ID: ${renewal.source_revision_id}`,`Stored operative revision hash: ${renewal.source_revision_hash}`);
 if(accepted)lines.push(`Renewal acceptance ID: ${accepted.id}`,`Renewal accepted at: ${accepted.accepted_at}`,`Accepted renewal document hash: ${accepted.document_hash}`,`Recorded consent: ${accepted.consent_text}`);
 lines.push(`Original executed agreement hash: ${a.original_document_hash}`,'All source documents and electronic acceptance evidence remain preserved unchanged.');
 lines.push('','HISTORICAL ORIGINAL BOOKING — NOT THE CURRENT RENEWAL PRICE');
 if(renewal.original_start_date&&renewal.original_end_date)lines.push(`Original booking period: ${agreementDate(renewal.original_start_date)} – ${agreementDate(renewal.original_end_date)}`);
 if(renewal.original_amount_cents!==null)lines.push(`Historical original booking total: ${agreementMoney(renewal.original_amount_cents,renewal.currency)} ${renewal.currency.toUpperCase()} (original transaction only).`);
 return lines.join('\n').replace(/^(ZONYX CURRENT OPERATIVE RENTAL AGREEMENT|CURRENT RENEWAL \/ EXTENSION TERMS|RENEWAL PAYMENT SUMMARY|RENEWAL BILLING SCHEDULE|VEHICLE AND RECORDED RENTAL CONDITIONS|ACCEPTED RENTAL TERMS|SOURCE RECORDS AND ACCEPTANCE EVIDENCE|HISTORICAL ORIGINAL BOOKING — NOT THE CURRENT RENEWAL PRICE)$/gm,'\n$1\n').replace(/\n{3,}/g,'\n\n').trim();
}
