import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { ZonyxPayBrand } from '@/components/rental/ZonyxPayBrand';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

type Details = { period_id: string; reservation_number: string; period_start: string; period_end: string; amount_cents: number; currency: string; payment_status: string; paid_at: string | null; plan_status: string; can_pay: boolean; preview?: boolean; checkout_state?: string | null };
async function renewalRequest(payload: Record<string, unknown>) {
 const { data, error } = await supabase.functions.invoke('renewal-checkout', { body: payload });
 if (error) { let message = error.message; const response = (error as { context?: Response }).context; if (response instanceof Response) { try { message = (await response.json()).error || message; } catch { /* Keep network error. */ } } throw new Error(message); }
 if (data?.error) throw new Error(data.error);
 return data;
}
export default function RenewalCheckout() {
 const [params] = useSearchParams(); const { user, loading } = useAuth();
 const periodId = params.get('periodId') || '', previewToken = params.get('preview') || '';
 const [working, setWorking] = useState(false), [message, setMessage] = useState('');
 const { data, error, isLoading, refetch } = useQuery({ queryKey: ['guest-renewal', periodId, previewToken, user?.id], queryFn: () => renewalRequest(previewToken ? { action: 'details', previewToken } : { action: params.get('return') === 'success' ? 'status' : 'details', periodId }) as Promise<Details>, enabled: Boolean(previewToken || periodId && user), retry: false });
 const pay = async () => {
  if (previewToken) { setMessage('Preview only — no card was charged and no payment was submitted. The Guest button opens Stripe’s secure payment page.'); return; }
  setWorking(true); setMessage('');
  try { const result = await renewalRequest({ action: 'checkout', periodId }); if (result.alreadyPaid) { await refetch(); return; } const url = new URL(result.url); if (url.origin !== 'https://checkout.stripe.com') throw new Error('Invalid secure payment destination.'); window.location.assign(url.href); } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Unable to open renewal payment.'); } finally { setWorking(false); }
 };
 const status = async () => { setWorking(true); setMessage(''); try { await renewalRequest({ action: 'status', periodId }); await refetch(); } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Payment status unavailable.'); } finally { setWorking(false); } };
 const loginPath = '/auth?redirectTo=' + encodeURIComponent('/booking/renewal?periodId=' + encodeURIComponent(periodId));
 const paid = data?.payment_status === 'paid' && Boolean(data.paid_at);
 return <MainLayout variant="booking"><main className="min-h-screen bg-black px-4 pb-24 pt-28"><section className="mx-auto max-w-md rounded-2xl border border-white/10 bg-black p-6 text-white"><ZonyxPayBrand /><div className="my-6 h-px bg-white/10" /><h1 className="text-2xl font-semibold">{paid ? 'Renewal Payment Confirmed' : 'Pay Your Rental Renewal'}</h1>
  {previewToken && <p role="status" className="mt-4 rounded-lg border border-amber-400/40 p-3 text-sm text-amber-200">Admin preview — this link cannot create a payment or charge a card.</p>}
  {(loading || isLoading) && <p className="mt-4">Loading renewal…</p>}
  {!previewToken && !loading && !user && <><p className="mt-4 text-sm text-neutral-300">Sign in with the account used for this reservation to review and pay your renewal.</p><Button asChild className="mt-6 w-full"><Link to={loginPath}>Sign in to continue</Link></Button></>}
  {error && <p role="alert" className="mt-4 text-red-300">{error.message}</p>}
  {data && <div className="mt-5 space-y-3 text-sm"><p>Reservation: <strong>{data.reservation_number}</strong></p><p>Renewal period: <strong>{data.period_start} → {data.period_end}</strong></p><p className="text-lg font-semibold">{paid ? 'Paid' : 'Amount due'}: {new Intl.NumberFormat('en-US', { style: 'currency', currency: data.currency.toUpperCase() }).format(data.amount_cents / 100)}</p><p className="text-neutral-400">This payment covers only this renewal period. Your original rental payment and security deposit remain separate.</p>
   {paid ? <p role="status" className="text-[#0fd8c4]">Your renewal payment has been verified. No additional payment is needed for this period.</p> : data.can_pay || data.preview ? <Button className="h-12 w-full bg-[#0fd8c4] text-[#031311] hover:bg-[#2fe6d3]" onClick={() => void pay()} disabled={working || data.checkout_state === 'processing'}>{working ? 'Opening secure payment…' : 'Pay Renewal'}</Button> : <p role="status">{data.plan_status !== 'active' ? 'This extension is not active yet. Contact ZONYX before paying.' : 'This renewal amount needs review. Contact ZONYX before paying.'}</p>}
   {!data.preview && !paid && <Button variant="outline" className="w-full" disabled={working} onClick={() => void status()}>Check Payment Status</Button>}
   {params.get('return') === 'cancel' && !paid && <p role="status">You returned without confirming payment. Your existing reservation was not canceled.</p>}
  </div>}
  {message && <p role="status" className="mt-4 text-sm text-amber-200">{message}</p>}<p className="mt-6 text-xs text-neutral-400">Questions? <a href="mailto:support@gozonyx.com" className="underline">support@gozonyx.com</a></p>
 </section></main></MainLayout>;
}
