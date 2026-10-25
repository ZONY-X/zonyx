import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { ZonyxPayBrand } from '@/components/rental/ZonyxPayBrand';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { onMeasurementChange, trackVerifiedPurchase } from '@/lib/measurement/google';
import type { VerifiedPurchase } from '@/lib/measurement/purchase';

export default function BookingSuccess() {
  const [params] = useSearchParams();
  const bookingId = params.get('bookingId') || '';
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [verified, setVerified] = useState<{ bookingId: string; userId: string; paymentSummary: { value: number; currency: string }; purchase: VerifiedPurchase | null } | null>(null);
  const [message, setMessage] = useState('Verifying your reservation…');
  useEffect(() => {
    setVerified(null);
    if (loading) return;
    if (!bookingId || !userId) { setMessage('Open your reservation while signed in to verify its payment status.'); return; }
    let disposed = false;
    setMessage('Verifying your reservation…');
    void supabase.functions.invoke('booking-conversion', { body: { bookingId } }).then(({ data, error }) => {
      if (disposed) return;
      if (error || data?.bookingConfirmed !== true || !data.paymentSummary) { setMessage('This booking has not been verified as confirmed. Check its status in your dashboard.'); return; }
      setVerified({ bookingId, userId, paymentSummary: data.paymentSummary, purchase: data.purchase });
    }).catch(() => { if (!disposed) setMessage('Verification is unavailable. Please check your dashboard.'); });
    return () => { disposed = true; };
  }, [bookingId, userId, loading]);
  const current = verified?.bookingId === bookingId && verified.userId === userId ? verified : null;
  useEffect(() => {
    if (!current?.purchase) return;
    const track = () => { void trackVerifiedPurchase(current.bookingId, current.purchase).catch(() => { /* Payment confirmation remains independent of analytics. */ }); };
    track();
    return onMeasurementChange(track);
  }, [current]);
  return <MainLayout variant="booking"><main className="min-h-screen bg-black px-4 pb-28 pt-28 sm:pt-32"><section role="status" className="mx-auto max-w-md rounded-2xl border border-white/10 p-8 text-center text-white">
    <ZonyxPayBrand />
    <h1 className="mt-8 text-2xl font-semibold">{current ? 'Booking Confirmed' : 'Booking verification'}</h1>
    <p className="mt-4 text-neutral-300">{current ? 'Your reservation is confirmed.' : message}</p>
    {current && <p className="mt-4">Payment received: {new Intl.NumberFormat('en-US', { style: 'currency', currency: current.paymentSummary.currency }).format(current.paymentSummary.value)}</p>}
    <Link to="/dashboard" className="mt-8 inline-block rounded-lg bg-[#0fd8c4] px-5 py-3 font-semibold text-black">View bookings</Link>
  </section></main></MainLayout>;
}
