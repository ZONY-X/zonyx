import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Stripe from 'npm:stripe@23.0.0';
import { renewalCheckoutParams, verifyRenewalPreview } from '../_shared/renewal-checkout.ts';
import { settleRenewalSession } from '../_shared/renewal-settlement.ts';
const cors = { 'Access-Control-Allow-Origin': 'https://www.gozonyx.com', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: cors });
Deno.serve(async request => {
 if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
 if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
 try {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !key || !anon) return json(503, { error: 'Renewal checkout unavailable.' });
  const input = await request.json();
  if (input.previewToken) {
   if (input.action !== 'details') return json(403, { error: 'Preview only. No payment can be submitted.' });
   const preview = await verifyRenewalPreview(String(input.previewToken), key);
   return json(200, { ...preview, preview: true, can_pay: false, payment_status: 'payment_due', plan_status: 'active' });
  }
  const authorization = request.headers.get('authorization') || '';
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return json(401, { error: 'Sign in to the account used for your reservation.' });
  const { data: details, error: detailsError } = await userClient.rpc('get_guest_renewal_details', { _period_id: input.periodId });
  if (detailsError) return json(403, { error: detailsError.message });
  const service = createClient(url, key);
  if (input.action === 'details') return json(200, details);
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return json(503, { error: 'Renewal payment provider unavailable.' });
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  if (input.action === 'status') {
   const { data: a } = await service.from('renewal_checkout_attempts').select('stripe_session_id').eq('period_id', input.periodId).order('generation', { ascending: false }).limit(1).maybeSingle();
   if (a?.stripe_session_id) await settleRenewalSession(service, stripe, a.stripe_session_id);
   const { data, error } = await userClient.rpc('get_guest_renewal_details', { _period_id: input.periodId });
   if (error) throw error;
   return json(200, data);
  }
  if (input.action !== 'checkout') return json(400, { error: 'Unsupported renewal action.' });
  const { data: prepared, error: prepareError } = await service.rpc('prepare_guest_renewal_checkout', { _period_id: input.periodId, _user_id: auth.user.id, _livemode: !stripeKey.includes('_test_') });
  if (prepareError) return json(409, { error: prepareError.message });
  if (prepared.already_paid) return json(200, { alreadyPaid: true });
  if (prepared.session_id) {
   const status = await settleRenewalSession(service, stripe, prepared.session_id);
   if (status.state === 'paid') return json(200, { alreadyPaid: true });
   if (status.state === 'open') return json(200, { url: prepared.session_url });
   if (status.state === 'processing') return json(409, { error: 'Your payment is processing. Check its status before starting another payment.' });
   return json(409, { error: 'This payment session expired. Select Pay Renewal again to start a new session.' });
  }
  const session = await stripe.checkout.sessions.create(renewalCheckoutParams(prepared), { idempotencyKey: prepared.idempotency_key });
  if (!session.url || session.metadata?.renewalAttemptId !== prepared.attempt_id || session.livemode !== prepared.livemode) throw new Error('Renewal session identity conflicts.');
  const { error: attachError } = await service.rpc('attach_guest_renewal_session', { _attempt_id: prepared.attempt_id, _session_id: session.id, _session_url: session.url, _expires_at: new Date(session.expires_at * 1000).toISOString() });
  if (attachError) throw attachError;
  if (session.status === 'expired') { await settleRenewalSession(service, stripe, session.id); return json(409, { error: 'This payment session expired. Select Pay Renewal again.' }); }
  return json(200, { url: session.url });
 } catch (error) { return json(400, { error: error instanceof Error ? error.message : 'Renewal checkout unavailable. Check the existing payment before retrying.' }); }
});
