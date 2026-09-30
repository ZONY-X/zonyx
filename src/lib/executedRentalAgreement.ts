export type ExecutedRentalAgreement = {
  id:string; booking_id:string; proposed_booking_id:string; reservation_number:string;
  master_agreement_id:string; master_version:string; master_title:string; master_content_hash:string; agreement_effective_at:string;
  guest_profile_id:string|null; guest_auth_user_id:string|null; prepared_at:string|null; accepted_at:string; accepted_ip:string|null; accepted_user_agent:string|null;
  document_hash:string; rendered_text:string; trip_financial_summary:{vehicle_vin?:string;vehicle_identifier?:string;authorized_drivers?:Array<{legal_name:string}>};
  electronic_acceptance_recorded:boolean; signature_method:"authenticated_electronic_acceptance"; audit_metadata_visible:boolean;
  original_document_hash:string; original_rendered_text:string|null;
  correction:null|{id:string;original_document_hash:string;corrected_document_hash:string;exact_correction:string;reason:string;corrected_at:string;actor_profile_id:string;actor_type:string;customer_reaccepted:false};
  current_revision?: AgreementRevision;
};

export type AgreementFieldChange={field:string;from:string|null;to:string|null};
export type AgreementRevision={id:string;revision_number:number;revision_type:string;document_hash:string;rendered_text:string;operative_state:Record<string,unknown>;field_changes:AgreementFieldChange[];reason:string;effective_at:string;created_at:string;created_by_profile_id:string|null;requires_customer_acceptance:boolean;customer_accepted_at:string|null;customer_auth_user_id?:string|null;customer_accepted_ip?:string|null;customer_accepted_user_agent?:string|null;previous_revision_id:string|null};
export type AgreementProposal={id:string;proposed_revision_number:number;document_hash:string;rendered_text:string;proposed_operative_state:Record<string,unknown>;field_changes:AgreementFieldChange[];reason:string;proposed_effective_at:string;created_at:string;created_by_profile_id:string};
export type AgreementHistory={booking_id:string;reservation_number:string;current_revision_id:string;revisions:AgreementRevision[];pending_proposals:AgreementProposal[];notifications:Array<{id:string;revision_id:string|null;proposal_id:string|null;notification_type:string;status:string;recipient_email:string;provider_message_id:string|null;subject:string;attempted_at:string;error_message:string|null}>};

export function downloadAgreementRevision(reservation:string,revision:AgreementRevision|AgreementProposal){
 const number="revision_number" in revision?revision.revision_number:revision.proposed_revision_number;const text=revision.rendered_text;
 const blob=new Blob([new TextEncoder().encode(text)],{type:"text/plain;charset=utf-8"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`${reservation.replace(/[^a-zA-Z0-9_-]+/g,"-")}-rental-agreement-revision-${number}.txt`;document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
}

export function executedAgreementFilename(agreement:ExecutedRentalAgreement){
  const reservation=(agreement.reservation_number||agreement.booking_id).replace(/[^a-zA-Z0-9_-]+/g,"-");
  if(agreement.current_revision&&agreement.current_revision.revision_number>1)return `${reservation}-current-operative-rental-agreement-revision-${agreement.current_revision.revision_number}.txt`;
  return `${reservation}-executed-rental-agreement-v${agreement.master_version}.txt`;
}

export const executedAgreementBytes=(agreement:ExecutedRentalAgreement)=>new TextEncoder().encode(agreement.rendered_text);

export function downloadExecutedAgreement(agreement:ExecutedRentalAgreement){
  const blob=new Blob([executedAgreementBytes(agreement)],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=executedAgreementFilename(agreement);document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
}