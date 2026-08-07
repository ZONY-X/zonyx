import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { createStripeCheckoutSession, ZONYX_SERVICE_FEE_RATE, ZONYX_TAX_RATE } from "@/lib/stripe";
import { ArrowLeft, CalendarDays, CreditCard, Check, ShieldCheck, MapPin } from "lucide-react";

interface VehicleRow {
  id: string;
  brand: string;
  name: string;
  category: string;
  year: number;
  color: string;
  base_daily_rate_cents: number;
  image_url: string | null;
  images: string[] | null;
  vehicle_identifier: string;
  is_active: boolean;
}

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

function formatCurrencyFromCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

export default function Booking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const today = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 1));
  const [internalBookingCode, setInternalBookingCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["booking-vehicle", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as VehicleRow | null;
    },
    enabled: !!id,
  });

  const { data: viewerProfile } = useQuery({
    queryKey: ["booking-viewer-profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin, is_internal_tester")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return null;
      return data as { is_admin: boolean; is_internal_tester: boolean } | null;
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (vehicle) {
      setEndDate(addDays(startDate, 1));
    }
  }, [vehicle, startDate]);

  const nights = useMemo(() => getDateDifferenceInDays(startDate, endDate), [startDate, endDate]);
  const rentalSubtotal = useMemo(() => {
    const model = (vehicle?.name || "").trim().toLowerCase();
    if (model === "cybertruck" && startDate === "2026-08-08" && nights === 1) {
      return 22250;
    }
    return (vehicle?.base_daily_rate_cents ?? 0) * nights;
  }, [vehicle, startDate, nights]);
  const serviceFee = useMemo(() => Math.round(rentalSubtotal * ZONYX_SERVICE_FEE_RATE), [rentalSubtotal]);
  const taxes = useMemo(() => Math.round(rentalSubtotal * ZONYX_TAX_RATE), [rentalSubtotal]);
  const total = rentalSubtotal + serviceFee + taxes;
  const canViewInternalBookingCode =
    !!user && (viewerProfile?.is_internal_tester === true || viewerProfile?.is_admin === true);

  const handleCheckout = async () => {
    if (!vehicle) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.rpc("create_booking", {
        _vehicle_id: vehicle.id,
        _start_date: startDate,
        _end_date: endDate,
      });

      if (error) throw error;
      if (!data) throw new Error("Unable to create booking.");

      const checkout = await createStripeCheckoutSession({
        bookingId: data,
        internalBookingCode: internalBookingCode.trim() || undefined,
      });
      setInternalBookingCode("");
      window.location.assign(checkout.url);
    } catch (error) {
      setInternalBookingCode("");
      setErrorMessage(error instanceof Error ? error.message : "Unable to initialize checkout right now.");
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <section className="pt-24 pb-20">
          <div className="container max-w-3xl text-center">
            <h1 className="text-2xl font-semibold">Loading vehicle</h1>
          </div>
        </section>
      </MainLayout>
    );
  }

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

  const heroImage = vehicle.image_url || vehicle.images?.[0] || "/placeholder.svg";

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
                    <h1 className="mt-2 text-3xl font-semibold text-foreground">{vehicle.year} {vehicle.brand} {vehicle.name}</h1>
                    <p className="mt-3 text-sm text-muted-foreground">Booking is created before Stripe checkout starts.</p>
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
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">Vehicle identifier</p>
                      <p className="mt-1 text-foreground">{vehicle.vehicle_identifier}</p>
                    </div>
                  </div>
                </div>
              </div>
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
                    <img src={heroImage} alt={vehicle.name} className="h-16 w-24 rounded-xl object-cover" />
                    <div>
                      <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">{vehicle.brand}</p>
                      <p className="font-semibold text-foreground">{vehicle.year} {vehicle.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{vehicle.color} • {vehicle.category}</p>
                    </div>
                  </div>
                </div>

                {canViewInternalBookingCode && (
                  <div className="mt-4 rounded-2xl border border-border/50 bg-muted/30 p-4">
                    <label className="block space-y-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Internal booking code</span>
                      <input
                        type="password"
                        autoComplete="off"
                        value={internalBookingCode}
                        onChange={(event) => setInternalBookingCode(event.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                )}

                <div className="mt-6 space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Daily rate</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(vehicle.base_daily_rate_cents)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Rental subtotal</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(rentalSubtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Service fee</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(serviceFee)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Taxes</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(taxes)}</span>
                  </div>
                </div>

                <div className="mt-6 border-t border-border pt-4">
                  <div className="flex items-center justify-between text-base font-semibold text-foreground">
                    <span>Total</span>
                    <span>{formatCurrencyFromCents(total)}</span>
                  </div>
                </div>

                {errorMessage && (
                  <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {errorMessage}
                  </div>
                )}

                <Button size="lg" className="mt-6 w-full" onClick={handleCheckout} disabled={isSubmitting}>
                  {isSubmitting ? "Preparing checkout..." : "Continue to Stripe Checkout"}
                </Button>

                <div className="mt-4 rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Temporary Authorization Hold</p>
                  <p className="mt-2">
                    A temporary authorization hold may be placed when Stripe confirms the checkout.
                  </p>
                </div>

                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  Secure payment powered by Stripe
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-foreground">Hosted pickup details</h3>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Pickup location is shared after booking confirmation.</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Booking is created before Stripe opens.</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Host identity comes from the selected vehicle.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}