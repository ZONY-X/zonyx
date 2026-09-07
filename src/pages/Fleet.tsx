import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { businessStructuredData, Seo } from "@/components/seo/Seo";
import { getVehicleCanonicalPath } from "@/lib/vehicleSlug.mjs";
import { useState, useEffect } from "react";

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
  display_order: number | null;
}

interface SearchContext {
  location: string;
  start: string;
  end: string;
}

function formatCurrencyFromCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

const parseDateParam = (raw: string | null): string | null => {
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

export default function Fleet() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const paramLocation = searchParams.get("location") || "";
  const paramStart = parseDateParam(searchParams.get("pickup"));
  const paramEnd = parseDateParam(searchParams.get("return"));

  const hasSearch = Boolean(paramLocation || paramStart || paramEnd);

  const [inlineLocation, setInlineLocation] = useState(paramLocation);
  const [inlineStart, setInlineStart] = useState(paramStart || new Date().toISOString().split("T")[0]);
  const [inlineEnd, setInlineEnd] = useState(paramEnd || "");

  useEffect(() => {
    setInlineLocation(paramLocation);
    setInlineStart(paramStart || new Date().toISOString().split("T")[0]);
    setInlineEnd(paramEnd || "");
  }, [paramLocation, paramStart, paramEnd]);

  const searchContext: SearchContext | null = hasSearch
    ? { location: paramLocation, start: paramStart || "", end: paramEnd || "" }
    : null;

  const canSearchInline = Boolean(inlineLocation || inlineStart || inlineEnd);

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ["fleet-vehicles", paramLocation, paramStart, paramEnd],
    queryFn: async () => {
      if (hasSearch) {
        const { data, error } = await supabase.rpc("search_available_vehicles", {
          _start_date: paramStart,
          _end_date: paramEnd,
          _location: paramLocation || null,
        });
        if (error) throw error;
        return (data ?? []) as VehicleRow[];
      }
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true, nullsLast: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as VehicleRow[];
    },
  });

  const handleInlineSearch = () => {
    const params = new URLSearchParams();
    if (inlineLocation) params.set("location", inlineLocation);
    if (inlineStart) params.set("pickup", inlineStart);
    if (inlineEnd) params.set("return", inlineEnd);
    setSearchParams(params);
  };


          <div className="mx-auto mb-8 max-w-3xl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                placeholder="Location (e.g. Miami Beach)"
                value={inlineLocation}
                onChange={(e) => setInlineLocation(e.target.value)}
                className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
              />
              <input
                type="date"
                value={inlineStart}
                onChange={(e) => setInlineStart(e.target.value)}
                className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
              />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  type="date"
                  value={inlineEnd}
                  onChange={(e) => setInlineEnd(e.target.value)}
                  className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
                />
                <Button onClick={handleInlineSearch} disabled={!canSearchInline}>Search</Button>
              </div>
            </div>
          </div>

          {searchContext && (
            <div className="mx-auto mb-6 max-w-3xl rounded-2xl border border-border bg-muted/40 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                <span className="font-medium text-foreground">Active search:</span>
                {searchContext.location && <span>Location: <strong className="text-foreground">{searchContext.location}</strong></span>}
                {searchContext.start && <span>From: <strong className="text-foreground">{formatDateLabel(searchContext.start)}</strong></span>}
                {searchContext.end && <span>Until: <strong className="text-foreground">{formatDateLabel(searchContext.end)}</strong></span>}
                <Button variant="ghost" size="sm" className="ml-auto px-2 py-0 h-6 text-xs"
                  onClick={() => setSearchParams(new URLSearchParams())}>
                  Clear
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="py-20 text-center text-muted-foreground">Loading vehicles...</div>
          ) : (
            <div>
              {searchContext && vehicles && (
                <p className="mb-4 text-center text-sm text-muted-foreground">
                  {vehicles.length} {vehicles.length === 1 ? "vehicle" : "vehicles"} available for your search
                </p>
              )}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {vehicles?.map((vehicle) => {
                  const heroImage = vehicle.image_url || vehicle.images?.[0] || "/placeholder.svg";
                  const vehiclePath = buildVehicleLink(vehicle, vehicles);
                  return (
                    <Card key={vehicle.id} className="overflow-hidden rounded-[1.4rem]">
                      <div className="aspect-[4/3] overflow-hidden bg-muted">
                        <img src={heroImage} alt={`${vehicle.brand} ${vehicle.name}`} className="h-full w-full object-cover" />
                      </div>
                      <CardContent className="space-y-4 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-display mb-1 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">{vehicle.brand}</p>
                            <h3 className="font-display text-lg font-semibold tracking-wide text-foreground">{vehicle.year} {vehicle.name}</h3>
                            <p className="font-display text-sm tracking-wide text-muted-foreground">{vehicle.category} • {vehicle.color}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-display text-xl font-semibold tracking-wide text-primary">{formatCurrencyFromCents(vehicle.base_daily_rate_cents)}</p>
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
              {!isLoading && vehicles && vehicles.length === 0 && (
                <div className="py-16 text-center text-muted-foreground">
                  <p className="text-lg font-medium">No vehicles available for this search.</p>
                  <p className="mt-1 text-sm">Try different dates or a different location.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </MainLayout>
  );
}

  const formatDateLabel = (iso: string) => {
    if (!iso) return "";
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return iso;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const buildVehicleLink = (vehicle: VehicleRow, allVehicles: VehicleRow[] | undefined) => {
    const basePath = getVehicleCanonicalPath(vehicle, allVehicles);
    if (!searchContext || !searchContext.start || !searchContext.end) return basePath;
    const params = new URLSearchParams();
    params.set("start", searchContext.start);
    params.set("end", searchContext.end);
    if (searchContext.location) params.set("pickupLocation", searchContext.location);
    return `${basePath.split("?")[0]}?${params.toString()}`;
  };

  return (
    <MainLayout>
      <Seo title="Tesla & Cybertruck Rentals in Miami | ZONYX" description="Explore ZONYX's premium electric vehicle fleet in Miami, including Tesla and Cybertruck rentals. View available vehicles and rental rates." path="/fleet" image="https://www.gozonyx.com/favicon-v2.png" structuredData={businessStructuredData} />
      <section className="pt-24 pb-20">
        <div className="container max-w-7xl">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <p className="font-display mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-primary">Premium marketplace</p>
            <h1 className="font-display mb-4 text-4xl font-semibold tracking-wide text-foreground md:text-5xl">
              {t("fleet.title")}
            </h1>
            <p className="font-display text-base leading-7 tracking-wide text-muted-foreground md:text-lg">
              Premium electric vehicles. Curated for Miami and South Florida.
            </p>
          </div>
