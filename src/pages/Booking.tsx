import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarDays, CreditCard, Check, Sparkles, ShieldCheck, MapPin } from "lucide-react";
import { createStripeCheckoutSession, ZONYX_SERVICE_FEE_RATE, ZONYX_TAX_RATE } from "@/lib/stripe";
import model3FsdImage from "@/assets/cars/model3-fsd.jpg";
import cybertruckImage from "@/assets/cars/cybertruck-fsd.png";
import cayenneSideImage from "@/assets/cars/cayenne-side.jpg";
import cayenneRearImage from "@/assets/cars/cayenne-rear.jpg";
import cayenneInteriorImage from "@/assets/cars/cayenne-interior.jpg";
import porscheTaycanImage from "@/assets/cars/porsche-taycan-green.jpg";
import porscheTaycanWheelImage from "@/assets/cars/porsche-taycan-wheel.jpg";

interface BookingVehicle {
  id: string;
  name: string;
  brand: string;
  category: string;
  pricePerDay: number;
  imageUrl: string;
  images?: string[];
  seats: number;
  transmission: "automatic" | "manual";
  fuelType: string;
  location: string;
  host: string;
  verified: boolean;
  superhost: boolean;
  pickupArea?: string;
  addOns?: Array<{ key: string; title: string; price: number; description: string }>;
}

const vehiclesData: BookingVehicle[] = [
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
    location: "Miami",
    host: "Zo",
    verified: true,
    superhost: true,
    pickupArea: "Coconut Grove, Miami",
    addOns: [
      { key: "fsd", title: "⚡ Full Self-Driving (Supervised)", price: 175, description: "Add Tesla Autopilot-style assistance for longer drives." },
      { key: "digital-key", title: "📱 Tesla Digital Key", price: 150, description: "Unlock and start the vehicle directly from your phone." },
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
    location: "Miami",
    host: "Miguel",
    verified: true,
    superhost: false,
    pickupArea: "Coconut Grove, Miami",
    addOns: [
      { key: "fsd", title: "⚡ Full Self-Driving (Supervised)", price: 175, description: "Add Tesla Autopilot-style assistance for longer drives." },
      { key: "digital-key", title: "📱 Tesla Digital Key", price: 150, description: "Unlock and start the vehicle directly from your phone." },
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
    location: "Fort Lauderdale",
    host: "Jim",
    verified: true,
    superhost: false,
    pickupArea: "Coconut Grove, Miami",
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
    location: "Homestead",
    host: "Alex",
    verified: false,
    superhost: false,
    pickupArea: "Coconut Grove, Miami",
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
    location: "Miami",
    host: "Juan Manuel",
    verified: true,
    superhost: true,
    pickupArea: "Coconut Grove, Miami",
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
    location: "Miami",
    host: "Elisa",
    verified: true,
    superhost: false,
    pickupArea: "Coconut Grove, Miami",
  },
];

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().split("T")[0];
}

function getDateDifferenceInDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const diff = end.getTime() - start.getTime();
  const dayCount = Math.round(diff / (1000 * 60 * 60 * 24));
  return dayCount > 0 ? dayCount : 1;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function Booking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const vehicle = vehiclesData.find((entry) => entry.id === id);

  const today = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 1));
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (vehicle) {
      setEndDate(addDays(startDate, 1));
    }
  }, [vehicle, startDate]);

  const nights = useMemo(() => getDateDifferenceInDays(startDate, endDate), [startDate, endDate]);
  const rentalBase = useMemo(() => (vehicle?.pricePerDay ?? 0) * nights, [vehicle, nights]);
  const selectedAddOnItems = useMemo(() => {
    return (vehicle?.addOns ?? []).filter((addon) => selectedAddOns[addon.key]);
  }, [selectedAddOns, vehicle]);
  const addOnTotal = useMemo(() => selectedAddOnItems.reduce((sum, addon) => sum + addon.price, 0), [selectedAddOnItems]);
  const subtotal = rentalBase + addOnTotal;
  const serviceFee = subtotal * ZONYX_SERVICE_FEE_RATE;
  const taxes = subtotal * ZONYX_TAX_RATE;
  const total = subtotal + serviceFee + taxes;

  if (!vehicle) {
    return (
      <MainLayout>
        <section className="pt-24 pb-20">
          <div className="container max-w-3xl text-center">
            <h1 className="text-2xl font-semibold">Vehicle not found</h1>
            <p className="mt-3 text-muted-foreground">The booking request could not be completed for this vehicle.</p>
            <Button asChild className="mt-6">
              <Link to="/fleet">Back to fleet</Link>
            </Button>
          </div>
        </section>
      </MainLayout>
    );
  }

  const handleAddOnToggle = (key: string) => {
    setSelectedAddOns((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleCheckout = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const checkout = await createStripeCheckoutSession({
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        vehiclePrice: vehicle.pricePerDay,
        startDate,
        endDate,
        nights,
        subtotal,
        serviceFee,
        taxes,
        total,
        addOns: selectedAddOnItems.map((addon) => ({ key: addon.key, title: addon.title, price: addon.price })),
      });

      window.location.assign(checkout.url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to initialize checkout right now.");
      setIsSubmitting(false);
    }
  };

  return (
    <MainLayout>
      <section className="pt-24 pb-20">
        <div className="container max-w-7xl">
          <Button variant="ghost" asChild className="mb-6">
            <Link to={`/vehicle/${vehicle.id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to vehicle
            </Link>
          </Button>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm md:p-8">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">Reserve your drive</p>
                    <h1 className="mt-2 text-3xl font-semibold text-foreground">{vehicle.name}</h1>
                    <p className="mt-3 text-sm text-muted-foreground">Book a premium EV with trusted local hosting and a seamless checkout flow.</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      Secure Stripe checkout
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm md:p-8">
                <h2 className="text-xl font-semibold text-foreground">Choose your rental dates</h2>
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Pickup date</span>
                    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      <input
                        type="date"
                        value={startDate}
                        min={today}
                        onChange={(event) => setStartDate(event.target.value)}
                        className="w-full bg-transparent text-sm outline-none"
                      />
                    </div>
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Return date</span>
                    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      <input
                        type="date"
                        value={endDate}
                        min={addDays(startDate, 1)}
                        onChange={(event) => setEndDate(event.target.value)}
                        className="w-full bg-transparent text-sm outline-none"
                      />
                    </div>
                  </label>
                </div>

                <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span>{nights} day rental · Pickup in {vehicle.pickupArea ?? "Coconut Grove, Miami"}</span>
                  </div>
                </div>
              </div>

              {vehicle.addOns && vehicle.addOns.length > 0 && (
                <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm md:p-8">
                  <h2 className="text-xl font-semibold text-foreground">Optional add-ons</h2>
                  <div className="mt-5 space-y-3">
                    {vehicle.addOns.map((addon) => {
                      const checked = Boolean(selectedAddOns[addon.key]);
                      return (
                        <label key={addon.key} className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-border bg-background/70 p-4">
                          <div className="flex gap-3">
                            <input type="checkbox" checked={checked} onChange={() => handleAddOnToggle(addon.key)} className="mt-1 h-4 w-4 rounded border-border text-primary" />
                            <div>
                              <p className="font-medium text-foreground">{addon.title}</p>
                              <p className="mt-1 text-sm text-muted-foreground">{addon.description}</p>
                            </div>
                          </div>
                          <span className="whitespace-nowrap text-sm font-semibold text-primary">+{formatCurrency(addon.price)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm md:p-8">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">Booking summary</h2>
                    <p className="text-sm text-muted-foreground">Review the total before payment.</p>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4">
                  <div className="flex items-center gap-3">
                    <img src={vehicle.imageUrl} alt={vehicle.name} className="h-16 w-24 rounded-xl object-cover" />
                    <div>
                      <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">{vehicle.brand}</p>
                      <p className="font-semibold text-foreground">{vehicle.name}</p>
                      <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 text-primary" />
                        {vehicle.location}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Daily rental price</span>
                    <span className="font-medium text-foreground">{formatCurrency(vehicle.pricePerDay)} × {nights}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Rental subtotal</span>
                    <span className="font-medium text-foreground">{formatCurrency(rentalBase)}</span>
                  </div>
                  {selectedAddOnItems.map((addon) => (
                    <div key={addon.key} className="flex items-center justify-between">
                      <span>{addon.title}</span>
                      <span className="font-medium text-foreground">+{formatCurrency(addon.price)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <span>Service fee</span>
                    <span className="font-medium text-foreground">{formatCurrency(serviceFee)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Taxes</span>
                    <span className="font-medium text-foreground">{formatCurrency(taxes)}</span>
                  </div>
                </div>

                <div className="mt-6 border-t border-border pt-4">
                  <div className="flex items-center justify-between text-base font-semibold text-foreground">
                    <span>Total</span>
                    <span>{formatCurrency(total)}</span>
                  </div>
                </div>

                {errorMessage && (
                  <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {errorMessage}
                  </div>
                )}

                <Button size="lg" className="mt-6 w-full" onClick={handleCheckout} disabled={isSubmitting}>
                  {isSubmitting ? "Preparing checkout…" : "Continue to Stripe Checkout"}
                </Button>

                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  Secure payment powered by Stripe
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-foreground">Hosted pickup details</h3>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Pickup location is shared after booking confirmation.</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Instant confirmation for approved bookings.</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Flexible support from the host before your trip.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}
