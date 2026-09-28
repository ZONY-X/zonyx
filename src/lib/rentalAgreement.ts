import { supabase } from "@/integrations/supabase/client";

export type RentalAgreementSummary = {
  agreement_version_id: string;
  agreement_version: string;
  agreement_effective_at: string;
  guest_profile_id: string;
  guest_auth_user_id: string;
  guest_legal_name: string;
  vehicle_id: string;
  vehicle_identifier: string;
  vehicle_vin: string;
  primary_authorized_driver: { profile_id: string; legal_name: string; role: "primary" };
  additional_authorized_drivers: Array<{ record_id: string; legal_name: string; role: "additional"; approved_at: string }>;
  damage_liability_excess: { amount_cents: number; currency: string; basis: "per_covered_incident" };
  reservation_specific_protection: null | { provider: string; product: string; insured_primary_driver: string; policy_or_certificate_number: string; coverage_start_at: string; coverage_end_at: string; protection_limit_cents: number | null; rental_vehicle_excess_cents: number | null; currency: string; verified_at: string; administrative_source: string; administrative_source_reference: string | null };
  final_total_cents: number;
  currency: string;
  authorization_hold_amount_cents: number;
  mileage_calculation_method: string;
  included_mileage_allowance: number;
  additional_mile_rate_cents: number;
  authorized_drivers: Array<{ profile_id: string; legal_name: string; role: string }>;
  additional_booking_specific_terms: string | null;
};

export type PreparedRentalAgreement = {
  agreementId: string;
  proposedBookingId: string;
  masterVersion: string;
  renderedText: string;
  documentHash: string;
  summary: RentalAgreementSummary;
};

type PrepareRentalAgreementInput = {
  idempotencyKey: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  pickupTime: string;
  dropoffTime: string;
  pickupLocation: string;
  dropoffLocation: string;
  promoCode?: string;
  internalBookingCode?: string;
  reservationContextId?: string;
  addOns: { fsd: boolean; digitalKey: boolean; airportDelivery: boolean; customDestination: boolean };
};

async function invokeRentalAgreement<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("rental-agreement", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const prepareRentalAgreement = (input: PrepareRentalAgreementInput) =>
  invokeRentalAgreement<PreparedRentalAgreement>({ action: "prepare", ...input });

export const acceptRentalAgreement = (input: { agreementId: string; documentHash: string; termsAccepted: boolean; rentalAgreementAccepted: boolean }) =>
  invokeRentalAgreement<{ bookingId: string; agreementId: string }>({ action: "accept", ...input });