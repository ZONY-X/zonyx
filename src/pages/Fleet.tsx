import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
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
  display_order: number | null;
}

interface SearchContext {
  location: string;
  start: string;
  end: string;
  pickupTime: string;
  dropoffTime: string;
}

const ZONYX_SERVICE_AREAS = [
  "Coconut Grove",
  "Brickell",
  "Downtown Miami",
  "Wynwood",
  "Miami Beach",
  "Coral Gables",
  "Edgewater",
  "Miami International Airport",
] as const;

const parseDateParam = (raw: string | null) => raw?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";

function formatCurrencyFromCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

function formatDateLabel(iso: string) {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function Fleet() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramLocation = searchParams.get("location") ?? "";
  const paramStart = parseDateParam(searchParams.get("pickup"));
  const paramEnd = parseDateParam(searchParams.get("return"));
  const paramPickupTime = searchParams.get("pickupTime") ?? "10:00";
  const paramDropoffTime = searchParams.get("dropoffTime") ?? "10:00";
  const hasSearch = Boolean(paramLocation || paramStart || paramEnd);
  const hasIncompleteDates = Boolean(paramStart) !== Boolean(paramEnd);

  const [inlineLocation, setInlineLocation] = useState(paramLocation);
  const [inlineStart, setInlineStart] = useState(paramStart);
  const [inlineEnd, setInlineEnd] = useState(paramEnd);
  const [inlinePickupTime, setInlinePickupTime] = useState(paramPickupTime);
  const [inlineDropoffTime, setInlineDropoffTime] = useState(paramDropoffTime);

  useEffect(() => {
    setInlineLocation(paramLocation);
    setInlineStart(paramStart);
    setInlineEnd(paramEnd);
    setInlinePickupTime(paramPickupTime);
    setInlineDropoffTime(paramDropoffTime);
  }, [paramDropoffTime, paramEnd, paramLocation, paramPickupTime, paramStart]);

  const searchContext: SearchContext | null = hasSearch
    ? { location: paramLocation, start: paramStart, end: paramEnd, pickupTime: paramPickupTime, dropoffTime: paramDropoffTime }
    : null;

  const { data: vehicles, isLoading, isError } = useQuery({
    queryKey: ["fleet-vehicles", paramLocation, paramStart, paramEnd, paramPickupTime, paramDropoffTime],
    queryFn: async () => {
      if (hasSearch) {
        const { data, error } = await supabase.rpc("search_available_vehicles", {
          _start_date: paramStart || undefined,
          _end_date: paramEnd || undefined,
          _pickup_time: paramPickupTime,
          _dropoff_time: paramDropoffTime,
          _location: paramLocation || undefined,
        });
        if (error) throw error;
        return (data ?? []) as VehicleRow[];
      }

      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("is_active", true)
        .eq("availability_status", "active")
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as VehicleRow[];
    },
  });

  const handleInlineSearch = () => {
    if (Boolean(inlineStart) !== Boolean(inlineEnd)) return;
    const params = new URLSearchParams();
    if (inlineLocation.trim()) params.set("location", inlineLocation.trim());
    if (inlineStart) params.set("pickup", inlineStart);
    if (inlineEnd) params.set("return", inlineEnd);
    params.set("pickupTime", inlinePickupTime);
    params.set("dropoffTime", inlineDropoffTime);
    setSearchParams(params);
  };

  const buildVehicleLink = (vehicle: VehicleRow) => {
    const basePath = getVehicleCanonicalPath(vehicle, vehicles);
    if (!searchContext) return basePath;
    const params = new URLSearchParams();
    if (searchContext.start) params.set("start", searchContext.start);
    if (searchContext.end) params.set("end", searchContext.end);
    params.set("pickupTime", searchContext.pickupTime);
    params.set("dropoffTime", searchContext.dropoffTime);
    if (searchContext.location) params.set("pickupLocation", searchContext.location);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <MainLayout variant="fleet">
      <Seo title="Tesla & Cybertruck Rentals in Miami | ZONYX" description="Explore ZONYX's premium electric vehicle fleet in Miami, including Tesla and Cybertruck rentals. View available vehicles and rental rates." path="/fleet" image="https://www.gozonyx.com/favicon-v2.png" structuredData={businessStructuredData} />
      <section className="zonyx-fleet-content pb-20 pt-32 md:pt-36 xl:pt-44">
        <div className="container max-w-7xl">
          <div className="mb-14 max-w-3xl md:mb-20">
            <p className="zonyx-fleet-eyebrow mb-4">Premium marketplace</p>
            <h1 className="zonyx-fleet-title mb-5">
              {t("fleet.title")}
            </h1>
            <p className="max-w-xl text-sm leading-7 text-white/60 md:text-base">
              Premium electric vehicles. Curated for Miami and South Florida.
            </p>
          </div>

          <div className="zonyx-fleet-search mx-auto mb-14 max-w-6xl border border-white/10 bg-[#05090a] p-4 md:mb-16 md:p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <select aria-label="Pickup location" value={inlineLocation} onChange={(event) => setInlineLocation(event.target.value)} className="zonyx-fleet-field px-4 py-3 text-sm outline-none">
                <option value="">Pickup location</option>
                {ZONYX_SERVICE_AREAS.map(area => <option key={area} value={area}>{area}</option>)}
              </select>
              <input type="date" aria-label="Pickup date" value={inlineStart} onChange={(event) => setInlineStart(event.target.value)} min={new Date().toISOString().split("T")[0]} className="zonyx-fleet-field px-4 py-3 text-sm outline-none" />
              <input type="time" aria-label="Pickup time" value={inlinePickupTime} onChange={(event) => setInlinePickupTime(event.target.value)} className="zonyx-fleet-field px-4 py-3 text-sm outline-none" />
              <input type="date" aria-label="Drop-off date" value={inlineEnd} onChange={(event) => setInlineEnd(event.target.value)} min={inlineStart || new Date().toISOString().split("T")[0]} className="zonyx-fleet-field px-4 py-3 text-sm outline-none" />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input type="time" aria-label="Drop-off time" value={inlineDropoffTime} onChange={(event) => setInlineDropoffTime(event.target.value)} className="zonyx-fleet-field min-w-0 px-3 py-3 text-sm outline-none" />
                <Button className="zonyx-home-primary rounded-none px-5 uppercase tracking-[0.12em]" onClick={handleInlineSearch} disabled={Boolean(inlineStart) !== Boolean(inlineEnd)}>Search</Button>
              </div>
            </div>
          </div>

          {hasIncompleteDates && <p className="mx-auto mb-6 max-w-5xl text-sm text-destructive">Select both pickup and drop-off dates to check availability.</p>}

          {searchContext && (
            <div className="mx-auto mb-8 max-w-6xl border border-white/10 bg-white/[0.025] p-4 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                <span className="font-medium text-foreground">Active search:</span>
                {searchContext.location && <span>Location: <strong className="text-foreground">{searchContext.location}</strong></span>}
                {searchContext.start && <span>Pickup: <strong className="text-foreground">{formatDateLabel(searchContext.start)} at {searchContext.pickupTime}</strong></span>}
                {searchContext.end && <span>Drop-off: <strong className="text-foreground">{formatDateLabel(searchContext.end)} at {searchContext.dropoffTime}</strong></span>}
                <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 py-0 text-xs" onClick={() => setSearchParams(new URLSearchParams())}>Clear</Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="py-20 text-center text-muted-foreground">Loading vehicles...</div>
          ) : isError ? (
            <div className="py-20 text-center text-destructive">Unable to check vehicle availability. Please try again.</div>
          ) : (
            <>
              {searchContext && <p className="mb-4 text-center text-sm text-muted-foreground">{vehicles?.length ?? 0} {(vehicles?.length ?? 0) === 1 ? "vehicle" : "vehicles"} available for your search</p>}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 xl:gap-7">
                {vehicles?.map((vehicle) => {
                const heroImage = vehicle.image_url || vehicle.images?.[0] || "/placeholder.svg";
                return (
                  <Card key={vehicle.id} className="zonyx-fleet-card group overflow-hidden rounded-sm border-white/10 bg-[#050809] shadow-none">
                    <div className="aspect-[4/3] overflow-hidden bg-[#090d0e]">
                      <img src={heroImage} alt={`${vehicle.brand} ${vehicle.name}`} className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.015]" />
                    </div>
                    <CardContent className="space-y-5 p-5 md:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[hsl(var(--home-teal))]">{vehicle.brand}</p>
                          <h3 className="font-display text-lg font-medium tracking-[0.025em] text-white">{vehicle.year} {vehicle.name}</h3>
                          <p className="mt-1 text-sm text-white/50">{vehicle.category} • {vehicle.color}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-semibold tracking-tight text-white">{formatCurrencyFromCents(vehicle.base_daily_rate_cents)}</p>
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">/day</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-white/10 pt-4">
                        <p className="text-xs tracking-wide text-white/40">ID: {vehicle.vehicle_identifier}</p>
                        <Button className="zonyx-fleet-card-action rounded-none border-white/20 bg-transparent uppercase tracking-[0.12em] text-white shadow-none" variant="outline" asChild size="sm">
                          <Link to={buildVehicleLink(vehicle)}>View Details</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
                })}
              </div>
              {vehicles?.length === 0 && <div className="py-16 text-center text-muted-foreground"><p className="text-lg font-medium">No vehicles available for this search.</p><p className="mt-1 text-sm">Try different dates, times, or a different pickup location.</p></div>}
            </>
          )}
        </div>
      </section>
    </MainLayout>
  );
}