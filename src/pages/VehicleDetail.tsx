import { useParams, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, Gauge, Fuel, ChevronLeft, ChevronRight, MapPin, Star, ShieldCheck, Sparkles, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import model3FsdImage from "@/assets/cars/model3-fsd.jpg";
import cybertruckImage from "@/assets/cars/cybertruck-fsd.png";
import cayenneSideImage from "@/assets/cars/cayenne-side.jpg";
import cayenneRearImage from "@/assets/cars/cayenne-rear.jpg";
import cayenneInteriorImage from "@/assets/cars/cayenne-interior.jpg";
import porscheTaycanImage from "@/assets/cars/porsche-taycan-green.jpg";
import porscheTaycanWheelImage from "@/assets/cars/porsche-taycan-wheel.jpg";

const vehiclesData = [
  {
    id: "1",
    name: "2025 Tesla Cybertruck AWD",
    brand: "Tesla",
    category: "Electric Pickup",
    pricePerDay: 249,
    imageUrl: cybertruckImage,
    images: [cybertruckImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    host: "Zo",
    rating: 5.0,
    trips: 38,
    location: "Miami",
    verified: true,
    superhost: true,
    pickupArea: "Coconut Grove, Miami",
    description: "The ultimate premium electric pickup for road trips, weekend escapes, and elevated city driving.",
    features: ["Adaptive Air Suspension", "Full Self-Driving", "Vault Storage", "All-Wheel Drive", "Premium Interior"],
    addOns: [
      { title: "⚡ Full Self-Driving (Supervised)", price: 175, description: "Enjoy Tesla's advanced driver assistance for longer highway stretches." },
      { title: "📱 Tesla Digital Key", price: 150, description: "Unlock and start the vehicle directly from your phone." },
    ],
  },
  {
    id: "2",
    name: "2025 Tesla Model 3",
    brand: "Tesla",
    category: "Electric Sedan",
    pricePerDay: 129,
    imageUrl: model3FsdImage,
    images: [model3FsdImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    host: "Miguel",
    rating: 4.98,
    trips: 21,
    location: "Miami",
    verified: true,
    superhost: false,
    pickupArea: "Coconut Grove, Miami",
    description: "A refined electric sedan built for premium city travel and effortless everyday luxury.",
    features: ["Autopilot", "Premium Audio", "Glass Roof", "Fast Charging", "Mobile App Access"],
    addOns: [
      { title: "⚡ Full Self-Driving (Supervised)", price: 175, description: "Enjoy Tesla's advanced driver assistance for longer highway stretches." },
      { title: "📱 Tesla Digital Key", price: 150, description: "Unlock and start the vehicle directly from your phone." },
    ],
  },
  {
    id: "3",
    name: "2025 Rivian R1S",
    brand: "Rivian",
    category: "Electric SUV",
    pricePerDay: 219,
    imageUrl: cayenneSideImage,
    images: [cayenneSideImage, cayenneRearImage, cayenneInteriorImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    host: "Jim",
    rating: 4.97,
    trips: 17,
    location: "Fort Lauderdale",
    verified: true,
    superhost: false,
    pickupArea: "Coconut Grove, Miami",
    description: "An adventurous premium SUV with exceptional comfort, space, and a polished host experience.",
    features: ["Adventure Mode", "Panoramic Roof", "Premium Cabin", "Off-Road Capability", "Fast Charging"],
  },
  {
    id: "4",
    name: "2025 Porsche Macan EV",
    brand: "Porsche",
    category: "Electric SUV",
    pricePerDay: 329,
    imageUrl: porscheTaycanImage,
    images: [porscheTaycanImage, porscheTaycanWheelImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    host: "Alex",
    rating: 4.9,
    trips: 0,
    location: "Homestead",
    verified: false,
    superhost: false,
    pickupArea: "Coconut Grove, Miami",
    description: "A luxurious electric SUV with performance-minded engineering and elevated comfort.",
    features: ["Sport Suspension", "Premium Audio", "Adaptive Cruise", "Panoramic Roof", "Launch Control"],
  },
  {
    id: "5",
    name: "2025 Lucid Air Touring",
    brand: "Lucid",
    category: "Electric Sedan",
    pricePerDay: 269,
    imageUrl: model3FsdImage,
    images: [model3FsdImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    host: "Juan Manuel",
    rating: 5.0,
    trips: 8,
    location: "Miami",
    verified: true,
    superhost: true,
    pickupArea: "Coconut Grove, Miami",
    description: "A serene, ultra-premium electric sedan designed for comfort and effortless long-distance travel.",
    features: ["Luxury Cabin", "Fast Charging", "Driver Assistance", "Massage Seats", "Adaptive Suspension"],
  },
  {
    id: "6",
    name: "Mercedes-Benz G580 EQ",
    brand: "Mercedes-Benz",
    category: "Electric SUV",
    pricePerDay: 389,
    imageUrl: cayenneSideImage,
    images: [cayenneSideImage, cayenneRearImage, cayenneInteriorImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    host: "Elisa",
    rating: 4.99,
    trips: 12,
    location: "Miami",
    verified: true,
    superhost: false,
    pickupArea: "Coconut Grove, Miami",
    description: "A statement-making electric SUV with understated luxury, spacious comfort, and serious presence.",
    features: ["Luxury Interior", "Adaptive Suspension", "Panoramic Roof", "Advanced Safety", "Premium Audio"],
  },
];

export default function VehicleDetail() {
  const { id } = useParams();
  const vehicle = vehiclesData.find((v) => v.id === id);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  if (!vehicle) {
    return (
      <MainLayout>
        <div className="container pt-24 pb-20 text-center">
          <h1 className="mb-4 text-2xl font-bold">Vehicle not found</h1>
          <Button asChild>
            <Link to="/fleet">Back to Fleet</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  const allImages = vehicle.images ?? [vehicle.imageUrl];
  const features = vehicle.features ?? [];

  const goToPrevious = () => {
    setCurrentImageIndex((prev) => (prev === 0 ? allImages.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentImageIndex((prev) => (prev === allImages.length - 1 ? 0 : prev + 1));
  };

  return (
    <MainLayout>
      <section className="pt-24 pb-20">
        <div className="container max-w-7xl">
          <Button variant="ghost" asChild className="mb-6">
            <Link to="/fleet">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Fleet
            </Link>
          </Button>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
            <div className="space-y-4">
              <div className="relative">
                <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-muted">
                  <img
                    src={allImages[currentImageIndex]}
                    alt={vehicle.name}
                    className="h-full w-full object-cover"
                  />
                </div>

                {allImages.length > 1 && (
                  <>
                    <button
                      onClick={goToPrevious}
                      className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm transition-colors hover:bg-background"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={goToNext}
                      className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm transition-colors hover:bg-background"
                    >
                      <ChevronRight className="h-5 h-5" />
                    </button>
                  </>
                )}
              </div>

              {allImages.length > 1 && (
                <div className="flex gap-2">
                  {allImages.map((img, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      className={cn(
                        "h-14 w-20 overflow-hidden rounded-lg border-2 transition-all",
                        index === currentImageIndex ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"
                      )}
                    >
                      <img src={img} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm md:p-8">
                <p className="mb-2 text-sm uppercase tracking-[0.3em] text-muted-foreground">{vehicle.brand}</p>
                <h1 className="text-3xl font-semibold text-foreground md:text-4xl">{vehicle.name}</h1>
                <div className="mt-4 flex flex-wrap gap-2">
                  {vehicle.superhost && (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">Superhost</span>
                  )}
                  {vehicle.verified && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      Verified host
                    </span>
                  )}
                  <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                    <MapPin className="h-4 w-4 text-primary" />
                    {vehicle.location}
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                    <Star className="h-4 w-4 fill-primary text-primary" />
                    {vehicle.rating?.toFixed(2)} · {vehicle.trips} trips
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Hosted by {vehicle.host}
                  </span>
                </div>

                <p className="mt-6 text-base leading-7 text-muted-foreground">{vehicle.description}</p>

                <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4">
                  <p className="text-sm font-semibold text-foreground">Pickup Area</p>
                  <p className="mt-1 text-lg font-medium text-foreground">{vehicle.pickupArea ?? "Coconut Grove, Miami"}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Exact meeting point shared after booking confirmation.</p>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Daily rate</p>
                    <div className="mt-1 flex items-end gap-2">
                      <span className="text-3xl font-semibold text-primary">${vehicle.pricePerDay}</span>
                      <span className="pb-1 text-sm text-muted-foreground">/day</span>
                    </div>
                  </div>
                  <span className={cn(
                    "rounded-full px-3 py-1 text-sm font-medium",
                    vehicle.available ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"
                  )}>
                    {vehicle.available ? "Available now" : "Unavailable"}
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-background/70 p-4 text-center">
                    <Users className="mx-auto mb-2 h-5 w-5 text-primary" />
                    <p className="text-sm text-muted-foreground">Seats</p>
                    <p className="font-semibold text-foreground">{vehicle.seats}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background/70 p-4 text-center">
                    <Gauge className="mx-auto mb-2 h-5 w-5 text-primary" />
                    <p className="text-sm text-muted-foreground">Transmission</p>
                    <p className="font-semibold capitalize text-foreground">{vehicle.transmission}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background/70 p-4 text-center">
                    <Fuel className="mx-auto mb-2 h-5 w-5 text-primary" />
                    <p className="text-sm text-muted-foreground">Fuel</p>
                    <p className="font-semibold text-foreground">{vehicle.fuelType}</p>
                  </div>
                </div>
              </div>

              {vehicle.brand === "Tesla" && vehicle.addOns && vehicle.addOns.length > 0 && (
                <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-foreground">Optional add-ons</h3>
                  <div className="mt-4 space-y-3">
                    {vehicle.addOns.map((addon) => (
                      <div key={addon.title} className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-background/70 p-4">
                        <div>
                          <p className="font-medium text-foreground">{addon.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{addon.description}</p>
                        </div>
                        <span className="whitespace-nowrap text-sm font-semibold text-primary">+${addon.price}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
                <Button size="lg" asChild className="w-full">
                  <Link to={`/booking/${vehicle.id}`}>Reserve and pay</Link>
                </Button>
              </div>

              <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-foreground">Why guests love this host</h3>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Flexible handoff and clear pickup instructions.</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Premium support from booking to drop-off.</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Clean, carefully maintained vehicles with concierge-style service.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}
