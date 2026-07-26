import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { SearchForm } from "@/components/booking/SearchForm";
import { VehicleCard, Vehicle } from "@/components/vehicles/VehicleCard";
import { AIAssistant } from "@/components/chat/AIAssistant";
import { RequestAccessModal } from "@/components/RequestAccessModal";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield, Clock, Star, Award } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import heroImage from "@/assets/cars/cybertruck-fsd-hero.png";
import model3FsdImage from "@/assets/cars/model3-fsd.jpg";
import cybertruckImage from "@/assets/cars/cybertruck-fsd.png";
import cayenneSideImage from "@/assets/cars/cayenne-side.jpg";
import cayenneRearImage from "@/assets/cars/cayenne-rear.jpg";
import cayenneInteriorImage from "@/assets/cars/cayenne-interior.jpg";
import porscheTaycanImage from "@/assets/cars/porsche-taycan-green.jpg";
import porscheTaycanWheelImage from "@/assets/cars/porsche-taycan-wheel.jpg";
const featuredVehicles: Vehicle[] = [{
  id: "1",
  name: "MODEL 3",
  brand: "Tesla",
  category: "Electric",
  pricePerDay: 89,
  imageUrl: model3FsdImage,
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true
}, {
  id: "2",
  name: "CYBERTRUCK",
  brand: "Tesla",
  category: "Truck",
  pricePerDay: 149,
  imageUrl: cybertruckImage,
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true
}, {
  id: "3",
  name: "NEW CAYENNE EV",
  brand: "Porsche",
  category: "Electric SUV",
  pricePerDay: 379,
  imageUrl: cayenneSideImage,
  images: [cayenneSideImage, cayenneRearImage, cayenneInteriorImage],
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true
}, {
  id: "4",
  name: "TAYCAN",
  brand: "Porsche",
  category: "Electric",
  pricePerDay: 349,
  imageUrl: porscheTaycanImage,
  images: [porscheTaycanImage, porscheTaycanWheelImage],
  seats: 4,
  transmission: "automatic",
  fuelType: "Electric",
  available: true
}];
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
                   LIMITS</h1>
                <h2 className="mt-4 hero-subtitle font-ui text-lg md:text-2xl">Premium Electric Vehicle Marketplace</h2>
                <p className="mt-3 text-sm md:text-lg text-muted-foreground font-ui max-w-xl">Discover premium electric vehicles from trusted local hosts.</p>
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

      {/* Featured Vehicles */}
      <section className="py-20">
        <div className="container">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-12">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-primary text-center">
                {t("fleet.title")}
              </h2>
            </div>
            <Button variant="ghost" asChild className="mt-4 md:mt-0">
              <Link to="/fleet">
                {t("fleet.viewAll")}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredVehicles.map((vehicle, index) => <VehicleCard key={vehicle.id} vehicle={vehicle} className="animate-slide-up" style={{
            animationDelay: `${index * 100}ms`
          } as React.CSSProperties} />)}
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