import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Seo } from '@/components/seo/Seo';
import { RentalContact, RentalQuestions } from '@/components/seo/RentalContact';
import { pages, pageSchema } from '@/lib/seoContent.mjs';
import { supabase } from '@/integrations/supabase/client';
import { getVehicleCanonicalPath } from '@/lib/vehicleSlug.mjs';

export default function RentalGuide() {
  const { pathname } = useLocation();
  const page = pages[pathname];
  const tesla = pathname === '/tesla-rental-miami';
  const { data: vehicles = [], isLoading, isError } = useQuery({
    queryKey: ['public-vehicle-slugs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('id,vehicle_identifier,year,brand,name').eq('is_active', true).eq('availability_status', 'active');
      if (error) throw error;
      return data ?? [];
    },
    enabled: tesla,
  });
  return <MainLayout variant="app">
    <Seo title={page.title} description={page.description} path={pathname} structuredData={pageSchema(pathname, page.title, [['Home', '/'], [tesla ? 'Tesla rentals' : 'Long-term rentals', pathname]])} />
    <article className="container max-w-6xl pb-20 pt-32 text-white">
      <nav aria-label="Breadcrumb" className="mb-8 text-sm text-white/60"><Link to="/">Home</Link> / {tesla ? 'Tesla rentals' : 'Long-term rentals'}</nav>
      <p className="text-xs uppercase tracking-[.2em] text-primary">ZONYX · Miami</p>
      <h1 className="mt-5 max-w-4xl font-display text-3xl leading-tight md:text-5xl">{page.h1}</h1>
      <p className="mt-7 max-w-3xl text-base leading-8 text-white/70">{page.intro}</p>
      <RentalContact />
      {tesla ? <section className="mt-10">
        <h2 className="font-display text-2xl">Compare Tesla models for your trip</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65">Start with the body style that fits your plans, then review the actual listing and dates. For a Cybertruck rental in Miami, open the pickup listing to see photos and its daily base rate. For other Tesla options, compare the sedan and SUV listings below. Confirm passenger and luggage needs with our team before reserving.</p>
        {isLoading && <p className="mt-5" role="status">Loading Tesla options…</p>}
        {isError && <p className="mt-5">Unable to load models right now. <Link to="/fleet" className="underline">Open the fleet</Link> or call our team.</p>}
        <ul className="mt-6 grid gap-4 md:grid-cols-2">{vehicles.filter(v => v.brand.toLowerCase() === 'tesla').map(v => <li key={v.id} className="rounded-lg border border-white/15 p-6"><Link className="text-lg underline underline-offset-4" to={getVehicleCanonicalPath(v, vehicles)}>{v.year} {v.brand} {v.name} rental in Miami</Link></li>)}</ul>
      </section> : <section className="mt-10">
        <h2 className="font-display text-2xl">What to include in a monthly rental inquiry</h2>
        <ul className="mt-5 list-disc space-y-3 pl-5 text-sm leading-7 text-white/70"><li>Your exact pickup and return dates, including times.</li><li>The Tesla, Cybertruck or other electric vehicle you prefer.</li><li>Your pickup location and whether you need help arranging delivery.</li><li>Your expected driving distance and charging plans.</li></ul>
        <h2 className="mt-10 font-display text-2xl">Compare the full trip, not just a daily rate</h2>
        <p className="mt-5 max-w-3xl text-sm leading-7 text-white/70">A longer rental needs a confirmed vehicle and date range. Ask our team to explain the total quote, mileage conditions, deposit, protection requirements and return arrangements. This page accepts inquiries; it does not promise monthly inventory, a special monthly price, or an automatic discount.</p>
        <p className="mt-5 text-sm"><Link to="/tesla-rental-miami" className="underline">Explore Tesla models</Link> · <Link to="/fleet" className="underline">Compare the electric fleet</Link></p>
      </section>}
      <RentalQuestions />
    </article>
  </MainLayout>;
}
