import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { businessStructuredData, Seo } from "@/components/seo/Seo";
import { getVehicleCanonicalPath } from "@/lib/vehicleSlug.mjs";

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
  is_active: boolean;
}

function formatCurrencyFromCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

export default function Fleet() {
  const { t } = useLanguage();

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ["fleet-vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as VehicleRow[];
    },
  });

  return (
    <MainLayout>
      <Seo title="Tesla & Cybertruck Rentals in Miami | ZONYX" description="Explore ZONYX's premium electric vehicle fleet in Miami, including Tesla and Cybertruck rentals. View available vehicles and rental rates." path="/fleet" image="https://www.gozonyx.com/favicon-v2.png" structuredData={businessStructuredData} />
      <section className="pt-24 pb-20">
        <div className="container max-w-7xl">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-primary">Premium marketplace</p>
            <h1 className="mb-4 text-4xl font-semibold text-foreground md:text-5xl">
              {t("fleet.title")}
            </h1>
            <p className="text-base leading-7 text-muted-foreground md:text-lg">
              Browse premium Tesla, Cybertruck, and electric vehicle rentals available through ZONYX in Miami and South Florida.
            </p>
          </div>

          {isLoading ? (
            <div className="py-20 text-center text-muted-foreground">Loading vehicles...</div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {vehicles?.map((vehicle) => {
                const heroImage = vehicle.image_url || vehicle.images?.[0] || "/placeholder.svg";
                const vehiclePath = getVehicleCanonicalPath(vehicle, vehicles);
                return (
                  <Card key={vehicle.id} className="overflow-hidden rounded-[1.4rem]">
                    <div className="aspect-[4/3] overflow-hidden bg-muted">
                      <img src={heroImage} alt={`${vehicle.brand} ${vehicle.name}`} className="h-full w-full object-cover" />
                    </div>
                    <CardContent className="space-y-4 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="mb-1 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">{vehicle.brand}</p>
                          <h3 className="text-lg font-semibold text-foreground">{vehicle.year} {vehicle.name}</h3>
                          <p className="text-sm text-muted-foreground">{vehicle.category} • {vehicle.color}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-semibold text-primary">{formatCurrencyFromCents(vehicle.base_daily_rate_cents)}</p>
                          <p className="text-xs text-muted-foreground">/day</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">ID: {vehicle.vehicle_identifier}</p>
                        <Button asChild size="sm">
                          <Link to={vehiclePath}>View Details</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </MainLayout>
  );
}