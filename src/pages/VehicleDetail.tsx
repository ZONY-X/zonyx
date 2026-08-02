import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Users, Gauge, Fuel, MapPin, ShieldCheck } from "lucide-react";

interface VehicleRow {
  id: string;
  brand: string;
  name: string;
  category: string;
  color: string;
  year: number;
  vehicle_identifier: string;
  base_daily_rate_cents: number;
  image_url: string | null;
  images: string[] | null;
  host_profile_id: string;
  is_active: boolean;
}

interface ProfileRow {
  id: string;
  full_name: string;
  avatar_url: string | null;
  is_host: boolean;
}

function formatCurrencyFromCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

export default function VehicleDetail() {
  const { id } = useParams();

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicle-detail", id],
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

  const { data: host } = useQuery({
    queryKey: ["vehicle-host", vehicle?.host_profile_id],
    queryFn: async () => {
      if (!vehicle?.host_profile_id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, is_host")
        .eq("id", vehicle.host_profile_id)
        .maybeSingle();
      if (error) throw error;
      return data as ProfileRow | null;
    },
    enabled: !!vehicle?.host_profile_id,
  });

  if (isLoading) {
    return (
      <MainLayout>
        <div className="container pt-24 pb-20 text-center">
          <h1 className="mb-4 text-2xl font-bold">Loading vehicle</h1>
        </div>
      </MainLayout>
    );
  }

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

  const heroImage = vehicle.image_url || vehicle.images?.[0] || "/placeholder.svg";

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
              <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-muted">
                <img src={heroImage} alt={vehicle.name} className="h-full w-full object-cover" />
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm md:p-8">
                <p className="mb-2 text-sm uppercase tracking-[0.3em] text-muted-foreground">{vehicle.brand}</p>
                <h1 className="text-3xl font-semibold text-foreground md:text-4xl">{vehicle.year} {vehicle.name}</h1>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                    <MapPin className="h-4 w-4 text-primary" />
                    {vehicle.category}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Active vehicle
                  </span>
                </div>

                <p className="mt-6 text-base leading-7 text-muted-foreground">
                  Identifier {vehicle.vehicle_identifier}. Host-controlled booking-first listing.
                </p>

                {host && (
                  <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4">
                    <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">Host</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{host.full_name}</p>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Daily rate</p>
                    <div className="mt-1 flex items-end gap-2">
                      <span className="text-3xl font-semibold text-primary">{formatCurrencyFromCents(vehicle.base_daily_rate_cents)}</span>
                      <span className="pb-1 text-sm text-muted-foreground">/day</span>
                    </div>
                  </div>
                  <span className="rounded-full px-3 py-1 text-sm font-medium bg-green-500/10 text-green-600">
                    Available now
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-background/70 p-4 text-center">
                    <Users className="mx-auto mb-2 h-5 w-5 text-primary" />
                    <p className="text-sm text-muted-foreground">Color</p>
                    <p className="font-semibold text-foreground">{vehicle.color}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background/70 p-4 text-center">
                    <Gauge className="mx-auto mb-2 h-5 w-5 text-primary" />
                    <p className="text-sm text-muted-foreground">Identifier</p>
                    <p className="font-semibold text-foreground">{vehicle.vehicle_identifier}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background/70 p-4 text-center">
                    <Fuel className="mx-auto mb-2 h-5 w-5 text-primary" />
                    <p className="text-sm text-muted-foreground">Category</p>
                    <p className="font-semibold text-foreground">{vehicle.category}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
                <Button size="lg" asChild className="w-full">
                  <Link to={`/booking/${vehicle.id}`}>Reserve and pay</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}