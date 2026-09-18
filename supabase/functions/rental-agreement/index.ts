import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { calculateAuthorizationHold } from "../../../src/lib/authorizationHold.ts";
import {
  RENTAL_AGREEMENT_TITLE,
  RENTAL_AGREEMENT_V1_2,
  RENTAL_AGREEMENT_VERSION,
  renderRentalAgreementV1_2,
} from "../../../src/lib/rentalAgreementV1_2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const FSD_ADDON_CENTS = 17500;
const DIGITAL_KEY_ADDON_CENTS = 15000;
const AIRPORT_DELIVERY_ADDON_CENTS = 12000;
const CUSTOM_DESTINATION_ADDON_CENTS = 12000;
const TAX_RATE = 0.08;
const MINIMUM_TOTAL_CENTS = 50;
const MASTER_ID = "ca580403-78a8-4af4-881f-b8ac76699e33";

type AddOns = { fsd?: boolean; digitalKey?: boolean; airportDelivery?: boolean; customDestination?: boolean };
type PrepareInput = {
  action: "prepare";
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
  addOns?: AddOns;
};
type AcceptInput = { action: "accept"; agreementId: string; documentHash: string; termsAccepted: boolean; rentalAgreementAccepted: boolean };

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const money = (cents: number, currency = "usd") => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: currency.toUpperCase(),
}).format(cents / 100);
const dateTime = (date: string, time: string, location: string) => `${date} / ${time.slice(0, 5)} / ${location}`;
const isAuthorizedInternalTest = (input: PrepareInput, email: string | null) =>
  Deno.env.get("ZONYX_INTERNAL_TEST_ENABLED") === "true"
  && Boolean(Deno.env.get("ZONYX_INTERNAL_TEST_EMAIL"))
  && email === Deno.env.get("ZONYX_INTERNAL_TEST_EMAIL")
  && input.internalBookingCode === Deno.env.get("ZONYX_INTERNAL_TEST_CODE");

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("authorization") || "";
    if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "Server configuration is incomplete." });
    if (!authorization) return json(401, { error: "Authentication required." });

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json(401, { error: "Invalid auth session." });

    const input = await request.json() as PrepareInput | AcceptInput;
    if (input.action === "accept") {
      const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      const userAgent = request.headers.get("user-agent") || "";
      const { data: bookingId, error } = await serviceClient.rpc("accept_prepared_rental_agreement", {
        _agreement_id: input.agreementId,
        _document_hash: input.documentHash,
        _terms_accepted: input.termsAccepted,
        _rental_agreement_accepted: input.rentalAgreementAccepted,
        _guest_auth_user_id: userData.user.id,
        _accepted_ip: forwardedFor,
        _accepted_user_agent: userAgent,
      });
      if (error) return json(400, { error: error.message });
      return json(200, { bookingId, agreementId: input.agreementId });
    }

    if (input.action !== "prepare") return json(400, { error: "Invalid Rental Agreement action." });
    if (!input.idempotencyKey || !input.vehicleId || !input.startDate || !input.endDate || !input.pickupTime || !input.dropoffTime || !input.pickupLocation || !input.dropoffLocation) {
      return json(400, { error: "Complete booking details are required." });
    }

    const { data: profile, error: profileError } = await serviceClient.from("profiles")
      .select("id,user_id,full_name,email").eq("user_id", userData.user.id).maybeSingle();
    if (profileError || !profile) return json(400, { error: "Guest profile not found." });

    const { data: eligibility } = await userClient.rpc("get_my_driver_eligibility", { _trip_end_date: input.endDate });
    if (eligibility?.[0]?.status !== "eligible_self_attested") return json(400, { error: "Driver eligibility requirements are not met." });
    const guestLegalName = eligibility[0].legal_name?.trim();
    if (!guestLegalName) return json(400, { error: "Guest legal name is required." });

    const { data: existingPreparation } = await serviceClient.from("booking_rental_agreements")
      .select("id,proposed_booking_id,master_version,rendered_text,document_hash,trip_financial_summary,preparation_expires_at")
      .eq("guest_profile_id", profile.id).eq("idempotency_key", input.idempotencyKey).is("accepted_at", null).maybeSingle();
    if (
      existingPreparation
      && new Date(existingPreparation.preparation_expires_at) > new Date()
      && (existingPreparation.trip_financial_summary as Record<string, unknown>)?.pricing_rule_version === "started_24_hour_periods_v1"
    ) {
      return json(200, {
        agreementId: existingPreparation.id,
        proposedBookingId: existingPreparation.proposed_booking_id,
        masterVersion: existingPreparation.master_version,
        renderedText: existingPreparation.rendered_text,
        documentHash: existingPreparation.document_hash,
        summary: existingPreparation.trip_financial_summary,
      });
    }

    const { data: vehicle, error: vehicleError } = await serviceClient.from("vehicles")
      .select("id,host_profile_id,year,brand,name,vehicle_identifier,base_daily_rate_cents,is_active,availability_status,mileage_calculation_method,included_mileage_allowance,additional_mile_rate_cents")
      .eq("id", input.vehicleId).eq("is_active", true).eq("availability_status", "active").maybeSingle();
    if (vehicleError || !vehicle) return json(400, { error: "Vehicle not found or inactive." });
    if (vehicle.mileage_calculation_method == null || vehicle.included_mileage_allowance == null || vehicle.additional_mile_rate_cents == null) {
      return json(400, { error: "Vehicle mileage terms are not configured." });
    }

    const { data: host } = await serviceClient.from("profiles").select("id,full_name,email").eq("id", vehicle.host_profile_id).maybeSingle();
    if (!host) return json(400, { error: "Vehicle provider not found." });

    const { data: rentalDays, error: rentalDaysError } = await serviceClient.rpc("calculate_rental_days", {
      _start_date: input.startDate,
      _pickup_time: input.pickupTime,
      _end_date: input.endDate,
      _dropoff_time: input.dropoffTime,
    });
    if (rentalDaysError || !Number.isInteger(rentalDays) || rentalDays < 1) return json(400, { error: "Drop-off must be after pickup." });

    const { data: available, error: availabilityError } = await userClient.rpc("check_vehicle_availability", {
      _vehicle_id: input.vehicleId, _start_date: input.startDate, _end_date: input.endDate,
      _pickup_time: input.pickupTime, _dropoff_time: input.dropoffTime,
    });
    if (availabilityError || !available) return json(409, { error: "Vehicle is not available for the selected dates." });

    let subtotalCents = vehicle.base_daily_rate_cents * rentalDays;
    let serviceFeeCents = Math.round(subtotalCents * 0.12);
    let taxesCents = Math.round(subtotalCents * TAX_RATE);
    const internalTest = isAuthorizedInternalTest(input, userData.user.email ?? null);
    if (internalTest) {
      subtotalCents = Math.max(1, Math.round(subtotalCents * 0.01));
      serviceFeeCents = 0;
      taxesCents = Math.round(subtotalCents * TAX_RATE);
    }

    const addOns = input.addOns || {};
    const addOnItems = [
      addOns.fsd ? { key: "fsd", label: "Full Self-Driving (FSD)", amount_cents: FSD_ADDON_CENTS } : null,
      addOns.digitalKey ? { key: "digital_key", label: "Digital Key / Tesla App Access", amount_cents: DIGITAL_KEY_ADDON_CENTS } : null,
      addOns.airportDelivery ? { key: "airport_delivery", label: "Airport Delivery", amount_cents: AIRPORT_DELIVERY_ADDON_CENTS } : null,
      addOns.customDestination ? { key: "custom_destination", label: "Custom Pickup / Drop-off Destination", amount_cents: CUSTOM_DESTINATION_ADDON_CENTS } : null,
    ].filter(Boolean) as { key: string; label: string; amount_cents: number }[];
    const addOnTotalCents = addOnItems.reduce((total, item) => total + item.amount_cents, 0);

    const normalizedPromoCode = (input.promoCode || "").trim().toUpperCase();
    let promoDiscountCents = 0;
    let promoCodeId: string | null = null;
    if (normalizedPromoCode) {
      const { data: promo } = await serviceClient.from("promo_codes")
        .select("id,discount_type,discount_value_cents,discount_percent,is_active,expires_at,max_uses,uses_count")
        .ilike("code", normalizedPromoCode).maybeSingle();
      const valid = promo && promo.is_active && (!promo.expires_at || new Date(promo.expires_at) > new Date()) && (promo.max_uses == null || promo.uses_count < promo.max_uses);
      if (!valid) return json(400, { error: "Invalid promo code." });
      promoCodeId = promo.id;
      const beforeDiscount = subtotalCents + serviceFeeCents + taxesCents + addOnTotalCents;
      promoDiscountCents = promo.discount_type === "percentage"
        ? Math.round(beforeDiscount * (Number(promo.discount_percent) || 0) / 100)
        : Number(promo.discount_value_cents) || 0;
    }

    const finalTotalCents = Math.max(MINIMUM_TOTAL_CENTS, subtotalCents + serviceFeeCents + taxesCents + addOnTotalCents - promoDiscountCents);
    const holdAmountCents = (internalTest ? 1 : calculateAuthorizationHold(vehicle.name || vehicle.brand, rentalDays)) * 100;
    const agreementId = crypto.randomUUID();
    const proposedBookingId = crypto.randomUUID();
    const { data: reservationNumber, error: reservationNumberError } = await serviceClient.rpc("generate_reservation_number");
    if (reservationNumberError || !reservationNumber) throw new Error("Unable to allocate a reservation number.");
    const mileageMethodLabels: Record<string, string> = {
      per_day_non_cumulative: "Per-day, non-cumulative",
      total_trip_cumulative: "Total-trip, cumulative",
      custom: "Custom booking-specific calculation",
    };
    const summary = {
      reservation_number: reservationNumber, vehicle_id: vehicle.id, host_profile_id: vehicle.host_profile_id, guest_profile_id: profile.id,
      start_date: input.startDate, end_date: input.endDate, pickup_time: input.pickupTime, dropoff_time: input.dropoffTime,
      pickup_location: input.pickupLocation, dropoff_location: input.dropoffLocation,
      fulfillment_method: addOns.airportDelivery ? "airport_delivery" : addOns.customDestination ? "delivery" : "pickup",
      pricing_rule_version: "started_24_hour_periods_v1",
      rental_days: rentalDays, daily_rate_cents: vehicle.base_daily_rate_cents, subtotal_cents: subtotalCents,
      service_fee_cents: serviceFeeCents, taxes_cents: taxesCents, add_ons: addOnItems, add_on_total_cents: addOnTotalCents,
      promo_code: normalizedPromoCode || null, promo_code_id: promoCodeId, promo_discount_cents: promoDiscountCents,
      final_total_cents: finalTotalCents, currency: "usd", authorization_hold_amount_cents: holdAmountCents,
      mileage_calculation_method: vehicle.mileage_calculation_method,
      included_mileage_allowance: vehicle.included_mileage_allowance,
      additional_mile_rate_cents: vehicle.additional_mile_rate_cents,
      authorized_drivers: [{ profile_id: profile.id, legal_name: guestLegalName, role: "guest" }],
      additional_booking_specific_terms: null, internal_test: internalTest,
    };
    const rentalCharges = [
      `Daily rate: ${money(vehicle.base_daily_rate_cents)} × ${rentalDays} day(s)`,
      `Rental subtotal: ${money(subtotalCents)}`,
      `Service / marketplace fees: ${money(serviceFeeCents)}`,
      `Taxes: ${money(taxesCents)}`,
      `Add-ons: ${addOnItems.length ? addOnItems.map((item) => `${item.label} (${money(item.amount_cents)})`).join(", ") : "None"}`,
      `Promo / discount: ${normalizedPromoCode ? `${normalizedPromoCode} (-${money(promoDiscountCents)})` : "None"}`,
      `Final agreed rental total: ${money(finalTotalCents)} USD`,
    ].join("\n");
    const renderedText = renderRentalAgreementV1_2({
      agreementId, accountId: userData.user.id, guestLegalName, bookingId: `${reservationNumber} / ${proposedBookingId}`,
      vehicle: `${vehicle.year} / ${vehicle.brand} / ${vehicle.name} / ${vehicle.vehicle_identifier}`,
      host: host.full_name || host.email,
      pickup: dateTime(input.startDate, input.pickupTime, input.pickupLocation),
      scheduledReturn: dateTime(input.endDate, input.dropoffTime, input.dropoffLocation),
      rentalCharges, securityDepositAuthorizationHold: `${money(holdAmountCents)} USD`,
      mileage: `${mileageMethodLabels[vehicle.mileage_calculation_method] || vehicle.mileage_calculation_method}; ${vehicle.included_mileage_allowance} included mile(s) ${vehicle.mileage_calculation_method === "per_day_non_cumulative" ? "per day" : "per trip"}`,
      additionalMileage: `${money(vehicle.additional_mile_rate_cents)} per additional mile`,
      authorizedDrivers: [guestLegalName], additionalBookingSpecificTerms: "None",
    });
    const documentHash = await sha256(renderedText);
    const masterHash = await sha256(RENTAL_AGREEMENT_V1_2);

    const { error: masterError } = await serviceClient.from("rental_agreement_versions").insert({
      id: MASTER_ID, version: RENTAL_AGREEMENT_VERSION, title: RENTAL_AGREEMENT_TITLE,
      canonical_body: RENTAL_AGREEMENT_V1_2, content_hash: masterHash,
      effective_at: "2026-09-13T00:00:00Z", status: "published",
    });
    if (masterError?.code === "23505") {
      const { data: existingMaster, error: existingMasterError } = await serviceClient.from("rental_agreement_versions")
        .select("id,version,content_hash,status").eq("version", RENTAL_AGREEMENT_VERSION).maybeSingle();
      if (existingMasterError || !existingMaster || existingMaster.id !== MASTER_ID || existingMaster.content_hash !== masterHash || existingMaster.status !== "published") {
        throw new Error("Published Rental Agreement v1.2 does not match the internal authoritative source.");
      }
    } else if (masterError) {
      throw masterError;
    }

    await serviceClient.from("booking_rental_agreements")
      .delete().eq("guest_profile_id", profile.id).eq("idempotency_key", input.idempotencyKey).is("accepted_at", null);
    const { error: agreementError } = await serviceClient.from("booking_rental_agreements").insert({
      id: agreementId, proposed_booking_id: proposedBookingId, master_agreement_id: MASTER_ID,
      master_version: RENTAL_AGREEMENT_VERSION, guest_profile_id: profile.id, guest_auth_user_id: userData.user.id,
      trip_financial_summary: summary, rendered_text: renderedText, document_hash: documentHash,
      idempotency_key: input.idempotencyKey, preparation_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    });
    if (agreementError) throw agreementError;
    return json(200, { agreementId, proposedBookingId, masterVersion: RENTAL_AGREEMENT_VERSION, renderedText, documentHash, summary });
  } catch (error) {
    console.error("rental agreement error", error);
    return json(500, { error: error instanceof Error ? error.message : "Unable to prepare Rental Agreement." });
  }
});