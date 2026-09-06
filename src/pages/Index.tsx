import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { SearchForm } from "@/components/booking/SearchForm";
import { AIAssistant } from "@/components/chat/AIAssistant";
import { RequestAccessModal } from "@/components/RequestAccessModal";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Shield, Clock, Star, Award } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import heroImage from "@/assets/cars/cybertruck-fsd-hero.png";
import { businessStructuredData, Seo } from "@/components/seo/Seo";

const testimonials = [{
  name: "Sarah Johnson",
  role: "Business Traveler",
  content: "ZONYX made my business trip seamless. The Tesla was immaculate and the pickup was instant.",
  rating: 5
}, {
  name: "Michael Chen",
  role: "Adventure Seeker",
  content: "Rented the Cybertruck through ZONYX for a road trip. Best decision ever. Will definitely book again!",
  rating: 5
}, {
  name: "Emily Williams",
  role: "Weekend Explorer",
  content: "The Model 3 was a dream—super clean, effortless pickup, and a truly premium experience from start to finish with ZONYX.",
  rating: 5
}];
export default function Index() {
  const { t } = useLanguage();
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [brokenCovers, setBrokenCovers] = useState<ReadonlySet<string>>(new Set());

  // THE ZONYX NETWORK showcase uses the CURRENT cover photo of ACTIVE listings,
  // in admin display_order (same selection as /fleet). Fully dynamic: when an
  // admin changes a vehicle's cover photo, HOME reflects it automatically.
  const { data: showcaseVehicles } = useQuery({
    queryKey: ["home-showcase-vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, image_url, images")
        .eq("is_active", true)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; image_url: string | null; images: string[] | null }>;
    },
  });

  const showcaseSlides = useMemo(
    () =>
      (showcaseVehicles ?? [])
        .map((vehicle) => vehicle.image_url || vehicle.images?.[0] || null)
        .filter((src): src is string =>
          Boolean(src) && src !== "/placeholder.svg" && !brokenCovers.has(src))
        .slice(0, 5),
    [showcaseVehicles, brokenCovers],
  );
  
  const features = [{
    icon: Shield,
    title: t("features.flexible"),
    description: t("features.flexibleDesc")
  }, {
    icon: Clock,
    title: t("features.support"),
    description: t("features.supportDesc")
  }, {
    icon: Star,
    title: t("features.noFees"),
    description: t("features.noFeesDesc")
  }, {
    icon: Award,
    title: t("features.private"),
    description: t("features.privateDesc")
  }];
  return <MainLayout>
      <Seo title="ZONYX | Premium Electric Vehicle Rentals in Miami" description="Rent premium electric vehicles in Miami with ZONYX. Explore Tesla, Cybertruck and luxury EV rentals with a streamlined booking experience." path="/" image="https://www.gozonyx.com/favicon-v2.png" structuredData={businessStructuredData} />
      {/* Hero Section */}
      <section className="relative min-h-[85vh] md:min-h-[90vh] flex items-end md:items-center justify-center overflow-hidden pb-8 md:pb-0">
        {/* Background Image */}
        <div className="absolute inset-0">
          <img src={heroImage} alt="Premium car rental" className="w-full h-full object-cover object-center" />
          {/* Top gradient - darker at top for header readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-background/90 via-background/40 to-transparent" />
          {/* Bottom gradient - darker at bottom */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        </div>

        {/* Content */}
        <div className="relative container pt-20 pb-8 md:py-20 hero-container">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            {/* Left content panel */}
            <div className="md:col-span-6 lg:col-span-5">
              <div className="hero-panel">
                <h1 className="hero-title font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-semibold">
                   MOVE WITHOUT LIMITS</h1>
                <h2 className="mt-4 hero-subtitle font-ui text-lg md:text-2xl">Premium Electric Vehicle Marketplace</h2>
<p className="mt-3 text-sm md:text-lg text-muted-foreground font-ui max-w-xl">Discover premium Tesla, Cybertruck, and luxury EV rentals from trusted local hosts across Miami and South Florida.</p>
                <div className="mt-6">
                  <Button className="hero-cta px-6 py-3 rounded-md" asChild>
                    <Link to="/fleet" className="flex items-center gap-2 font-ui">Browse Vehicles <ArrowRight className="w-4 h-4" /></Link>
                  </Button>
                </div>
              </div>
            </div>

            {/* Spacer on small, keep cybertruck visible as background */}
            <div className="md:col-span-6 lg:col-span-7 hidden md:block" aria-hidden>
              {/* Intentionally empty: background image remains the visual focus */}
            </div>
          </div>

          {/* Search Form */}
          <div className="animate-slide-up animation-delay-300 mt-24 md:mt-0">
            <SearchForm />
          </div>

          {/* Request Access Box */}
          <div className="animate-slide-up animation-delay-500 mt-6">
            <div className="inline-block bg-card/80 backdrop-blur-sm border rounded-xl p-4 md:p-6 border-secondary">
              <Button variant="outline" size="lg" className="mb-2" onClick={() => setAccessModalOpen(true)}>
                REQUEST ACCESS
              </Button>
              <p className="text-xs md:text-sm text-muted-foreground">
                (Hosting is by Invitation or Approval)
              </p>
            </div>
          </div>

          {/* Request Access Modal */}
          <RequestAccessModal open={accessModalOpen} onOpenChange={setAccessModalOpen} />
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-card/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {features.map((feature, index) => <div key={feature.title} className="text-center p-6 rounded-xl bg-card border border-border animate-slide-up" style={{
            animationDelay: `${index * 100}ms`
          }}>
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>)}
          </div>
        </div>
      </section>

      {/* THE ZONYX NETWORK — cinematic vehicle showcase. Photography dissolves
          into the page: no card frame, edge/bottom fades, restrained overlay. */}
      <section aria-label="The ZONYX network" className="relative overflow-hidden py-16 md:py-24">
        <div className="container">
          <div className="mb-10 text-center md:mb-14">
            <h2 className="text-3xl font-semibold tracking-[0.18em] text-foreground md:text-5xl">
              THE ZONYX NETWORK
            </h2>
            <p className="mt-4 text-sm text-muted-foreground md:text-base">
              Premium electric vehicles, available across South Florida.
            </p>
          </div>
        </div>

        <div className="relative h-[68vh] min-h-[420px] w-full md:h-[82vh]">
          {showcaseSlides.map((src, index) => (
            <img
              key={src}
              src={src}
              alt=""
              aria-hidden="true"
              onError={() => setBrokenCovers((prev) => new Set(prev).add(src))}
              className="zonyx-showcase-slide absolute inset-0 h-full w-full object-cover"
              style={{
                animationDelay: `${index * 7}s`,
                animationDuration: `${Math.max(showcaseSlides.length, 1) * 7}s`,
              }}
            />
          ))}

          {/* Cinematic grade: light overall darkening for type contrast... */}
          <div className="pointer-events-none absolute inset-0 bg-background/20" />
          {/* ...dissolving edges: top, bottom (strongest), and side fades */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-background to-transparent md:h-36" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background via-background/80 to-transparent md:h-80" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent md:w-48" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent md:w-48" />

          <div className="absolute inset-x-0 bottom-10 flex flex-col items-center gap-5 text-center md:bottom-20 md:gap-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-foreground/90 md:text-sm">
              TESLA · RIVIAN · PORSCHE · AND MORE
            </p>
            <Button size="lg" asChild>
              <Link to="/fleet">
                EXPLORE VEHICLES
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-card/30">
        <div className="container">
          <div className="text-center mb-12">
            <span className="text-sm font-medium text-primary mb-2 block">{t("testimonials.label")}</span>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t("testimonials.title")}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => <div key={testimonial.name} className="p-6 rounded-xl bg-card border border-border animate-slide-up" style={{
            animationDelay: `${index * 100}ms`
          }}>
                <div className="flex items-center gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => <Star key={i} className="w-4 h-4 fill-primary text-primary" />)}
                </div>
                <p className="text-foreground mb-4">"{testimonial.content}"</p>
                <div>
                  <p className="font-semibold text-foreground">{testimonial.name}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                </div>
              </div>)}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-10">
        <div className="container">
          <div className="relative rounded-2xl overflow-hidden bg-gradient-primary p-3 md:p-6 text-center">
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
                {t("cta.title")}
              </h2>
              <p className="text-primary-foreground/80 mb-8 max-w-2xl mx-auto">{t("cta.description")}</p>
              <Button size="xl" variant="secondary" asChild>
                <Link to="/fleet">
                  {t("cta.button")}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* AI Assistant */}
      <AIAssistant />
    </MainLayout>;
}