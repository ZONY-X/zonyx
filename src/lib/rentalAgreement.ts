import { supabase } from "@/integrations/supabase/client";

export type RentalAgreementSummary = {
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