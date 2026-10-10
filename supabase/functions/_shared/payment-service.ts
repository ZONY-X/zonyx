import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  assertAmountIntegrity,
  assertInternalCheckout,
  customerPayPalEnabled,
  PaymentError,
  type PayPalOrder,
  planSecurityDeposit,
  validatePayPalOrder,
} from "./payment-policy.ts";
export const env = (name: string) => Deno.env.get(name);
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
export const serviceClient = () =>
  createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
export type DB = ReturnType<typeof serviceClient>;
export type Payment = {
  id: string;
  booking_id: string;
  agreement_id: string;
  provider: string;
  environment: string;
  amount_cents: number;
  currency: string;
  state: string;
  order_id: string | null;
  capture_id: string | null;
  approval_url: string | null;
  checkout_method: "card" | "paypal_wallet";
  create_request_id: string;
  capture_request_id: string;
};
export async function rpc<T>(
  db: DB,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    throw new PaymentError(
      409,
      "Payment state could not be updated. Reconcile the existing payment before retrying.",
    );
  }
  return data as T;
}
export async function authenticate(request: Request, operationsOnly = false) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new PaymentError(401, "Authentication required.");
  }
  const client = createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new PaymentError(401, "Invalid authentication.");
  }
  if (
    !customerPayPalEnabled(env) && !(operationsOnly && env("PAYPAL_ENVIRONMENT")==="live" && env("PAYPAL_LIVE_OPERATIONS_ENABLED")==="true" && env("PAYPAL_CUSTOMER_RELEASE_VERIFIED")==="true") && (env("ZONYX_INTERNAL_TEST_ENABLED") !== "true" ||
    !env("ZONYX_INTERNAL_TEST_EMAIL") ||
    data.user.email !== env("ZONYX_INTERNAL_TEST_EMAIL"))
  ) {
    throw new PaymentError(
      403,
      "Only the configured internal tester may use PayPal checkout.",
    );
  }
  return data.user;
}
export async function validateBooking(
  db: DB,
  bookingId: string,
  agreementId: string,
  userId: string,
  readOnly = false,
) {
  const { data: profile } = await db.from("profiles").select(
    "id,is_internal_tester,is_admin,user_id",
  ).eq("user_id", userId).single();
  const { data: booking } = await db.from("bookings").select("*").eq(
    "id",
    bookingId,
  ).single();
  if (!profile || !booking || booking.renter_profile_id !== profile.id) {
    throw new PaymentError(404, "Booking not found for current user.");
  }
  const { data: agreement } = await db.from("booking_rental_agreements").select(
    "*",
  ).eq("id", agreementId).eq("booking_id", bookingId).single();
  if (
    !agreement?.accepted_at || agreement.guest_auth_user_id !== userId ||
    !agreement.document_hash || !booking.terms_accepted_at ||
    !booking.rental_agreement_accepted_at
  ) {
    throw new PaymentError(
      409,
      "Accepted booking-specific Rental Agreement required.",
    );
  }
  if (customerPayPalEnabled(env)) {
    if (agreement.trip_financial_summary?.internal_test !== false || profile.is_internal_tester === true) throw new PaymentError(403, "Customer checkout cannot use internal test terms.");
  } else assertInternalCheckout(
    readOnly ? "true" : env("PAYPAL_RENTAL_CHECKOUT_ENABLED"),
    agreement.trip_financial_summary?.internal_test,
    profile.is_internal_tester === true || profile.is_admin === true,
  );
  const managedVehicles = (env("PAYPAL_MANAGED_VEHICLE_IDS") || "").split(",")
    .map((value) => value.trim()).filter(Boolean);
  if (!managedVehicles.includes(booking.vehicle_id)) {
    throw new PaymentError(
      403,
      "Vehicle is not approved as ZONYX-managed PayPal test inventory.",
    );
  }
  if (!readOnly && booking.trip_status === "pending_payment") await rpc(db,"validate_vehicle_rental_duration",{_vehicle_id:booking.vehicle_id,_start_date:booking.start_date,_pickup_time:booking.pickup_time,_end_date:booking.end_date,_dropoff_time:booking.dropoff_time});
  assertAmountIntegrity(booking, agreement.trip_financial_summary);
  return booking;
}
export async function ownedPayment(db: DB, id: string, userId: string, readOnly = false) {
  const { data: payment } = await db.from("booking_payments").select("*").eq(
    "id",
    id,
  ).eq("provider", "paypal").single();
  if (!payment) throw new PaymentError(404, "Rental payment not found.");
  await validateBooking(db, payment.booking_id, payment.agreement_id, userId, readOnly);
  return payment as Payment;
}
export async function persistOrderOutcome(
  db: DB,
  payment: Payment,
  order: PayPalOrder,
) {
  const capture = validatePayPalOrder(order, payment);
  if (capture?.status === "COMPLETED" && order.status === "COMPLETED") {
    return rpc<Record<string, unknown>>(db, "finalize_paypal_rental_payment", {
      _payment_id: payment.id,
      _order_id: order.id,
      _capture_id: capture.id,
      _amount_cents: payment.amount_cents,
      _currency: payment.currency,
      _deposit_status:
        planSecurityDeposit(env("PAYPAL_SECURITY_DEPOSIT_ENABLED")).status,
    });
  }
  if (
    capture?.status === "DECLINED" || capture?.status === "FAILED" ||
    order.status === "VOIDED"
  ) {
    await rpc(db, "record_paypal_payment_state", {
      _payment_id: payment.id,
      _state: "failed",
    });
    return { state: "failed", bookingConfirmed: false };
  }
  return {
    state: payment.state === "capturing"
      ? "reconciliation_required"
      : payment.state,
    bookingConfirmed: false,
  };
}
export function paymentFailure(error: unknown) {
  // Do not serialize provider responses, credentials, tokens, or arbitrary errors.
  return error instanceof PaymentError
    ? json(error.status, { error: error.message })
    : json(500, {
      error:
        "Unable to process payment. Reconcile the existing payment before retrying.",
    });
}

export async function validateRentalEligibility(
  request: Request,
  db: DB,
  booking: Record<string, unknown>,
) {
  const userClient = createClient(
    env("SUPABASE_URL")!,
    env("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: { Authorization: request.headers.get("authorization")! },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: eligibility, error } = await userClient.rpc(
    "get_my_driver_eligibility",
    { _trip_end_date: booking.end_date },
  );
  if (error || eligibility?.[0]?.status !== "eligible_self_attested") {
    throw new PaymentError(
      409,
      "Driver eligibility must be valid before rental payment.",
    );
  }
  const { data: vehicle } = await db.from("vehicles").select("id").eq(
    "id",
    booking.vehicle_id,
  ).eq("is_active", true).eq("availability_status", "active").maybeSingle();
  if (!vehicle) {
    throw new PaymentError(409, "Vehicle is not eligible for rental payment.");
  }
}
