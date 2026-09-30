export type ExecutedRentalAgreement = {
  id:string; booking_id:string; proposed_booking_id:string; reservation_number:string;
  master_agreement_id:string; master_version:string; master_title:string; master_content_hash:string; agreement_effective_at:string;
  guest_profile_id:string|null; guest_auth_user_id:string|null; prepared_at:string|null; accepted_at:string; accepted_ip:string|null; accepted_user_agent:string|null;
  document_hash:string; rendered_text:string; trip_financial_summary:{vehicle_vin?:string;vehicle_identifier?:string;authorized_drivers?:Array<{legal_name:string}>};
  electronic_acceptance_recorded:boolean; signature_method:"authenticated_electronic_acceptance"; audit_metadata_visible:boolean;
};

export function executedAgreementFilename(agreement:ExecutedRentalAgreement){
  const reservation=(agreement.reservation_number||agreement.booking_id).replace(/[^a-zA-Z0-9_-]+/g,"-");
  return `${reservation}-executed-rental-agreement-v${agreement.master_version}.txt`;
}

export const executedAgreementBytes=(agreement:ExecutedRentalAgreement)=>new TextEncoder().encode(agreement.rendered_text);

export function downloadExecutedAgreement(agreement:ExecutedRentalAgreement){
  const blob=new Blob([executedAgreementBytes(agreement)],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=executedAgreementFilename(agreement);document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
}