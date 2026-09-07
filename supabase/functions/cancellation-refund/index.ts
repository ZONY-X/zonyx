import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { planBookingCancellation } from '../_shared/cancellation-refund.ts';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const stripeApiBase = 'https://api.stripe.com/v1';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
function basicAuthHeader(): string {
  return `Basic ${btoa(`${stripeSecretKey}:`)}`;
}

async function retrievePaymentIntent(id: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${stripeApiBase}/payment_intents/${id}`, { headers: { Authorization: basicAuthHeader() } });
  return res.ok ? res.json() : null;
}

async function retrievePIFromSession(sessionId: string): Promise<string | null> {
  const params = new URLSearchParams();
  params.set('expand[]', 'payment_intent');
  const res = await fetch(`${stripeApiBase}/checkout/sessions/${sessionId}`, { headers: { Authorization: basicAuthHeader() } });
  if (!res.ok) return null;
  const session = await res.json();
  const pi = session.payment_intent;
  return typeof pi === 'string' ? pi : pi?.id ?? null;
}

async function refundPayment(pi: string, amount: number): Promise<{ id: string; status: string } | null> {
  const body = new URLSearchParams();
  body.set('payment_intent', pi);
  body.set('amount', String(amount));
  const res = await fetch(`${stripeApiBase}/refunds`, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearerPrefix = 'Bearer ';
    let jwt = '';
    if (authHeader.startsWith(bearerPrefix)) {
      jwt = authHeader.substring(bearerPrefix.length);
    }
    if (!jwt) return jsonResponse(401, { error: 'Authentication required.' });
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: authUser, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authUser?.user) return jsonResponse(401, { error: 'Invalid authentication.' });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId.trim() : '';
    const cancelType = typeof body.cancelType === 'string' ? body.cancelType : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!bookingId) return jsonResponse(400, { error: 'A bookingId is required.' });
    if (!cancelType) return jsonResponse(400, { error: 'A cancelType is required.' });

    const requesterId = authUser.user.id;
    const { data: requesterProfile } = await supabase
      .from('profiles').select('id, role').eq('user_id', requesterId).maybeSingle();
    const actorRole = requesterProfile?.role === 'admin' ? 'admin' : requesterProfile?.role === 'host' ? 'host' : 'guest';
    const actorProfileId = requesterProfile?.id ?? requesterId;

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, trip_status, renter_profile_id, host_profile_id, subtotal_cents, service_fee_cents, taxes_cents, grand_total_cents, stripe_checkout_session_id, authorization_hold_status, authorization_hold_payment_intent_id')
      .eq('id', bookingId).maybeSingle();
    if (bookingError || !booking) return jsonResponse(404, { error: 'Booking not found.' });

    const isOwner = booking.renter_profile_id === actorProfileId;
    const isHostOrAdmin = actorRole === 'admin' || booking.host_profile_id === actorProfileId;
    if (!isOwner && !isHostOrAdmin) return jsonResponse(403, { error: 'Not authorized to cancel this booking.' });

    let refundPI: string | null = null;
    if (booking.stripe_checkout_session_id) refundPI = await retrievePIFromSession(booking.stripe_checkout_session_id);
    const hasRefundablePayment = Boolean(refundPI);

    const plan = planBookingCancellation({
      tripStatus: booking.trip_status,
      actorRole,
      subtotalCents: Number(booking.subtotal_cents || 0),
      serviceFeeCents: Number(booking.service_fee_cents || 0),
      taxesCents: Number(booking.taxes_cents || 0),
      grandTotalCents: Number(booking.grand_total_cents || 0),
      hasCheckoutSession: Boolean(booking.stripe_checkout_session_id),
      hasRefundablePayment,
    });
    if (!plan.ok) return jsonResponse(409, { error: plan.reason });

    let stripeRefundId: string | null = null;
    let refundAmountCents = plan.refundCents;
    if (plan.refundCents > 0 && refundPI) {
      const piRecord = await retrievePaymentIntent(refundPI);
      if (!piRecord || (piRecord.status !== 'succeeded' && piRecord.status !== 'requires_capture')) {
        return jsonResponse(409, { error: 'Payment is not in a refundable state.' });
      }
      const refundResult = await refundPayment(refundPI, plan.refundCents);
      if (!refundResult) return jsonResponse(502, { error: 'Stripe refund failed. Please retry.' });
      stripeRefundId = refundResult.id;
    }

    const { error: persistError } = await supabase.rpc('persist_booking_cancellation', {
      _booking_id: booking.id,
      _cancel_type: cancelType,
      _cancel_reason: reason,
      _actor_role: actorRole,
      _actor_profile_id: actorProfileId,
      _stripe_refund_id: stripeRefundId,
      _refund_amount_cents: stripeRefundId ? refundAmountCents : 0,
    });
    if (persistError) return jsonResponse(500, { error: 'Failed to record cancellation.' });

    let depositReleased = false;
    if (booking.authorization_hold_status && booking.authorization_hold_status !== 'released') {
      await supabase.functions.invoke('authorization-hold-actions', { body: { bookingId: booking.id, action: 'release' } });
      depositReleased = true;
    }

    return jsonResponse(200, {
      ok: true, bookingId: booking.id, cancelType,
      refundCents: stripeRefundId ? refundAmountCents : 0,
      stripeRefundId, depositReleased,
    });
  } catch (error) {
    return jsonResponse(500, { error: 'Internal server error.' });
  }
});

  if (!res.ok) return null;
  const r = await res.json();
  return { id: r.id, status: r.status };
}
