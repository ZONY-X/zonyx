import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { env, rpc, type DB, type Payment, validateRentalEligibility } from "./payment-service.ts";
import { PaymentError, assertAmountIntegrity } from "./payment-policy.ts";
import { assertSquareCoverage, validateSquarePayment, type SquarePayment } from "./square-policy.ts";
import { SquareClient } from "./square-client.ts";
export async function squareUser(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new PaymentError(401, "Sign in to continue.");
  const client = createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !env("ZONYX_INTERNAL_TEST_EMAIL") || env("ZONYX_INTERNAL_TEST_ENABLED") !== "true" || data.user.email !== env("ZONYX_INTERNAL_TEST_EMAIL")) throw new PaymentError(403, "Square sandbox is limited to the configured tester.");
  return data.user;
}
export async function squareBooking(db: DB, bookingId: string, agreementId: string, userId: string) {
  const { data: g } = await db.from("profiles").select("*").eq("user_id", userId).single();
  const { data: b } = await db.from("bookings").select("*").eq("id", bookingId).single();
  const { data: a } = await db.from("booking_rental_agreements").select("*").eq("id", agreementId).eq("booking_id", bookingId).single();
  if (!g || !b || b.renter_profile_id !== g.id || (!g.is_internal_tester && !g.is_admin)) throw new PaymentError(404, "Booking not found for tester.");
  if (!a?.accepted_at || !a.document_hash || a.guest_auth_user_id !== userId || a.trip_financial_summary?.internal_test !== true || !b.terms_accepted_at || !b.rental_agreement_accepted_at) throw new PaymentError(409, "Accepted sandbox rental agreement required.");
  if (!(env("SQUARE_MANAGED_VEHICLE_IDS") || "").split(",").map(s => s.trim()).includes(b.vehicle_id)) throw new PaymentError(403, "Vehicle is not approved for Square sandbox.");
  assertAmountIntegrity(b, a.trip_financial_summary);
  return { ...b, depositAmountCents: Number(a.trip_financial_summary.authorization_hold_amount_cents) };
}
export async function squareOwned(db: DB, id: string, userId: string) {
  const { data: p } = await db.from("booking_payments").select("*").eq("id", id).eq("provider", "square").single();
  if (!p || p.environment !== "sandbox") throw new PaymentError(404, "Square sandbox payment not found.");
  await squareBooking(db, p.booking_id, p.agreement_id, userId);
  return p as Payment;
}
export async function squareDeposit(db: DB, id: string) {
  const { data: d, error } = await db.from("booking_security_deposits").select("*").eq("rental_payment_id", id).eq("generation", 1).single();
  if (error || !d || d.provider !== "square") throw new PaymentError(409, "Existing Square hold requires reconciliation.");
  return d;
}
export async function squareRecord(db: DB, client: SquareClient, p: Payment, hold: boolean, canonical: SquarePayment) {
  const d = await squareDeposit(db, p.id);
  try {
  validateSquarePayment(canonical, { id: hold ? d.provider_authorization_id : p.order_id, reference: hold ? d.id : p.id, location: client.location, amount: hold ? d.amount_cents : p.amount_cents, hold });
  } catch (error) { await rpc(db, "flag_square_reconciliation", {_payment_id:p.id}); throw error; }
  await rpc(db, "record_square_payment", { _payment_id: p.id, _hold: hold, _provider_id: canonical.id, _status: canonical.status, _amount: canonical.amount_money.amount, _expires: hold ? canonical.delayed_until || null : null });
  if (!hold && Number(canonical.refunded_money?.amount) > 0) await rpc(db, "flag_square_reconciliation", {_payment_id:p.id});
}
export async function squareStatus(db: DB, client: SquareClient, p: Payment) {
  // Read durable state again: webhook recovery may have populated identifiers.
  const { data: current, error } = await db.from("booking_payments").select("*").eq("id", p.id).single();
  if (error || !current) throw new PaymentError(503, "Square payment state unavailable.");
  const d = await squareDeposit(db, p.id);
  const { data: operation, error: operationError } = await db.from("square_payment_operations").select("*").eq("payment_id", p.id).single();
  if (operationError || !operation) throw new PaymentError(503, "Square operation state unavailable.");
  const hold = d.provider_authorization_id ? await client.get(d.provider_authorization_id) : operation.hold_started ? await client.find(d.id, current.created_at) : null;
  if (hold) await squareRecord(db, client, current, true, hold);
  const rental = current.order_id ? await client.get(current.order_id) : operation.rental_started ? await client.find(p.id, current.created_at) : null;
  if (rental) await squareRecord(db, client, current, false, rental);
  await rpc(db, "reconcile_square_booking", { _payment_id: p.id });
  const receipt = await rpc<Record<string, unknown>>(db, "get_provider_rental_payment_receipt", { _booking_id: p.booking_id });
  return { ...receipt, provider: "square", paymentId: p.id };
}
export async function squarePreflight(request: Request, db: DB, booking: Record<string, unknown>) {
  await validateRentalEligibility(request, db, booking);
  assertSquareCoverage(await rpc<string>(db, "paypal_trip_inspection_deadline", { _booking_id: booking.id }));
}
