import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Instagram, Linkedin, MapPin, ShieldCheck, Youtube, Zap } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { SearchForm } from "@/components/booking/SearchForm";
import { AIAssistant } from "@/components/chat/AIAssistant";
import { RequestAccessModal } from "@/components/RequestAccessModal";
import { MotionReveal } from "@/components/motion/MotionReveal";
import { Button } from "@/components/ui/button";
import { businessStructuredData, Seo } from "@/components/seo/Seo";
import { supabase } from "@/integrations/supabase/client";
import heroImage from "@/assets/cars/cybertruck-fsd-hero.png";
import interiorImage from "@/assets/cars/cayenne-interior.jpg";
import lifestyleImage from "@/assets/cars/porsche-taycan-green.jpg";
import zonyxLogo from "@/assets/zonyx-official-logo.png";

const benefits = [
  { icon: Zap, title: "All electric", description: "Cleaner tomorrows" },
  { icon: CalendarDays, title: "Flexible rentals", description: "On your terms" },
  { icon: ShieldCheck, title: "Insured & secure", description: "Drive with confidence" },
  { icon: MapPin, title: "Convenient delivery", description: "Miami & beyond" },
];

export default function Index() {
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [brokenCovers, setBrokenCovers] = useState<ReadonlySet<string>>(new Set());
  const bookingRef = useRef<HTMLDivElement>(null);
  const { data: showcaseVehicles } = useQuery({
    queryKey: ["home-showcase-vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, image_url, images").eq("is_active", true).order("display_order", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; image_url: string | null; images: string[] | null }>;
    },
  });
  const showcaseSlides = useMemo(() => (showcaseVehicles ?? [])
    .map((vehicle) => vehicle.image_url || vehicle.images?.[0] || null)
    .filter((src): src is string => Boolean(src) && src !== "/placeholder.svg" && !brokenCovers.has(src))
    .slice(0, 5), [showcaseVehicles, brokenCovers]);
  const openBooking = () => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return <div className="zonyx-home min-h-screen bg-black text-white">
    <Header variant="home" onRequestAccess={() => setAccessModalOpen(true)} />
    <Seo title="ZONYX | Premium Electric Vehicle Rentals in Miami" description="Rent premium electric vehicles in Miami with ZONYX. Explore Tesla, Cybertruck and luxury EV rentals with a streamlined booking experience." path="/" image="https://www.gozonyx.com/favicon-v2.png" structuredData={businessStructuredData} />

    <main>
      <section className="zonyx-home-hero relative flex min-h-[760px] items-center overflow-hidden border-b border-white/10 lg:min-h-[860px]">
        <img src={heroImage} alt="Tesla Cybertruck overlooking the Miami skyline" className="absolute inset-0 h-full w-full object-cover" />
        <div className="zonyx-home-hero-grade absolute inset-0" />
        <MotionReveal className="relative z-10 mx-auto w-full max-w-[1536px] px-6 pb-28 pt-36 sm:px-10 lg:px-14" threshold={0.05}>
          <div className="max-w-[700px]">
            <p className="zonyx-home-eyebrow">Move without limits</p>
            <h1 className="zonyx-home-title mt-5">Access more,<br />on the road.</h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-white/85 sm:text-lg">Premium electric vehicles. On demand.<br />A simpler, smarter way to drive.</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Button size="lg" className="zonyx-home-primary rounded-full px-9 uppercase" onClick={openBooking}>Book now <ArrowRight /></Button>
              <Button size="lg" variant="outline" className="zonyx-home-secondary rounded-full px-8 uppercase" asChild><Link to="/fleet">Explore fleet</Link></Button>
            </div>
          </div>
        </MotionReveal>
        <div className="absolute bottom-8 left-6 z-10 hidden items-center gap-5 sm:flex sm:left-10 lg:left-14"><span className="h-px w-12 bg-white" /><div><p className="zonyx-home-label">Miami, FL</p><p className="mt-1 text-[10px] tracking-[0.3em] text-white/70">25.7617° N, 80.1918° W</p></div></div>
        <div className="absolute bottom-8 right-14 z-10 hidden items-center gap-5 lg:flex"><div className="text-right"><p className="zonyx-home-label">Cybertruck</p><p className="mt-1 text-[10px] tracking-[0.25em] text-white/70">Bold by nature</p></div><span className="h-px w-12 bg-white" /></div>
      </section>

      <div ref={bookingRef} className={`zonyx-home-booking ${searchOpen ? "is-open" : ""}`} aria-hidden={!searchOpen}>
        <div className="mx-auto max-w-[1100px] px-5 sm:px-8"><SearchForm variant="home" /></div>
      </div>

      <section id="how-it-works" className="border-b border-white/10 bg-[#020607]">
        <MotionReveal className="mx-auto grid max-w-[1400px] grid-cols-2 px-5 py-10 sm:px-8 lg:grid-cols-4 lg:py-20" stagger={80}>
          {benefits.map((benefit, index) => <div key={benefit.title} className={`zonyx-home-benefit ${index % 2 ? "border-l" : ""} lg:border-l ${index === 0 ? "lg:border-l-0" : ""}`}>
            <benefit.icon className="mb-5 h-8 w-8 text-[hsl(var(--home-teal))]" strokeWidth={1.4} />
            <h2 className="zonyx-home-label">{benefit.title}</h2><p className="mt-2 text-[10px] uppercase tracking-[0.25em] text-white/55">{benefit.description}</p>
          </div>)}
        </MotionReveal>
      </section>

      <section id="about" className="relative min-h-[520px] overflow-hidden border-b border-white/10 lg:min-h-[560px]">
        <div className="absolute inset-y-0 right-0 w-full lg:w-[62%]"><img src={interiorImage} alt="Premium electric vehicle interior" className="h-full w-full object-cover" /><div className="absolute inset-0 bg-black/50 lg:bg-gradient-to-r lg:from-black lg:via-transparent lg:to-transparent" /></div>
        <MotionReveal className="relative z-10 mx-auto flex min-h-[520px] max-w-[1536px] items-center px-6 py-20 sm:px-10 lg:min-h-[560px] lg:px-14">
          <div className="max-w-[530px]"><h2 className="zonyx-home-heading">More<br className="hidden lg:block" /> freedom ahead</h2><p className="mt-6 max-w-md text-sm leading-7 text-white/80 sm:text-base">Whether it’s a daily drive, a weekend escape, or a business trip, ZONYX gives you access to exceptional electric vehicles without the hassle.</p><Button variant="outline" className="zonyx-home-secondary mt-8 rounded-xl px-7 uppercase" asChild><Link to="/fleet">Explore fleet <ArrowRight /></Link></Button></div>
        </MotionReveal>
      </section>

      <section className="relative min-h-[420px] overflow-hidden border-b border-white/10 lg:min-h-[450px]">
        <div className="absolute inset-y-0 right-0 w-full lg:w-[76%]"><img src={lifestyleImage} alt="Electric Porsche ready for a different kind of journey" className="h-full w-full object-cover object-center" /><div className="absolute inset-0 bg-gradient-to-r from-black via-black/65 to-black/10" /></div>
        <MotionReveal className="relative z-10 mx-auto flex min-h-[420px] max-w-[1536px] items-center px-6 py-16 sm:px-10 lg:min-h-[450px] lg:px-14">
          <div className="max-w-sm"><p className="zonyx-home-eyebrow flex items-center gap-4">Zonyx <span className="h-px w-10 bg-white" /></p><h2 className="zonyx-home-heading mt-6">Travel<br />different</h2><p className="mt-5 text-sm leading-6 text-white/80">Same roads.<br />A cleaner, brighter future.</p><Link to="/fleet" className="mt-6 inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--home-teal))] transition-colors hover:text-[hsl(var(--home-teal-light))]">Learn more <ArrowRight className="h-4 w-4" /></Link></div>
        </MotionReveal>
      </section>

      {showcaseSlides.length > 0 && <section className="relative h-[360px] overflow-hidden border-b border-white/10 sm:h-[460px]">
        {showcaseSlides.map((src, index, slides) => <img key={`${src}-${index}`} src={src} alt="" aria-hidden="true" onError={() => setBrokenCovers((current) => new Set(current).add(src))} className="zonyx-showcase-slide absolute inset-0 h-full w-full object-cover" style={{ animationDelay: `${index * 7}s`, animationDuration: `${slides.length * 7}s`, opacity: slides.length === 1 ? 1 : undefined }} />)}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/40 to-black/20" /><div className="absolute inset-0 flex items-center px-6 sm:px-10 lg:px-14"><div><p className="zonyx-home-eyebrow">The ZONYX network</p><h2 className="zonyx-home-heading mt-5">Your next drive<br />is waiting</h2><Button className="zonyx-home-primary mt-7 rounded-full px-8 uppercase" asChild><Link to="/fleet">Explore vehicles <ArrowRight /></Link></Button></div></div>
      </section>}
    </main>

    <footer className="bg-[#020506] px-6 py-9 sm:px-10 lg:px-14"><div className="mx-auto flex max-w-[1536px] flex-col items-center gap-8 lg:flex-row lg:justify-between">
      <Link to="/" className="w-44"><img src={zonyxLogo} alt="ZONYX" className="h-auto w-full" /></Link>
      <nav className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-[10px] font-semibold uppercase tracking-[0.14em]"><Link to="/fleet">Fleet</Link><a href="#how-it-works">How it works</a><Link to="/become-host">Be a host</Link><a href="#about">About</a><Link to="/contact">Contact</Link></nav>
      <div className="flex items-center gap-5"><a href="https://www.instagram.com/gozonyx" target="_blank" rel="noreferrer" aria-label="Instagram"><Instagram /></a><a href="https://www.youtube.com/@gozonyx" target="_blank" rel="noreferrer" aria-label="YouTube"><Youtube /></a><a href="https://www.linkedin.com/company/zonyx" target="_blank" rel="noreferrer" aria-label="LinkedIn"><Linkedin /></a><span className="hidden h-9 w-px bg-white/30 sm:block" /><p className="hidden text-[10px] uppercase leading-5 tracking-[0.22em] text-white/80 sm:block">Access more,<br />on the road.</p></div>
    </div></footer>

    <RequestAccessModal open={accessModalOpen} onOpenChange={setAccessModalOpen} />
    <AIAssistant />
  </div>;
}