import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Seo } from "@/components/seo/Seo";
import { getVehicleCanonicalPath, isVehicleUuid, resolveVehicleReference } from "@/lib/vehicleSlug.mjs";

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
  availability_status: "active" | "unavailable" | "coming_soon";
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
  const { vehicleReference } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [showAllImages, setShowAllImages] = useState(false);

  const { data: publicVehicles = [] } = useQuery({
    queryKey: ["public-vehicle-slugs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, vehicle_identifier, year, brand, name").eq("is_active", true).eq("availability_status", "active");
      if (error) throw error;
      return data;
    },
  });

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicle-detail", vehicleReference],
    queryFn: async () => {
      if (!vehicleReference) return null;
      const reference = isVehicleUuid(vehicleReference) ? vehicleReference : resolveVehicleReference(vehicleReference, publicVehicles)?.vehicle.id;
      if (!reference) return null;
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("id", reference)
        .maybeSingle();
      if (error) throw error;
      return data as VehicleRow | null;
    },
    enabled: Boolean(vehicleReference) && (isVehicleUuid(vehicleReference) || publicVehicles.length > 0),
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

  useEffect(() => {
    if (!vehicle || !vehicleReference || !isVehicleUuid(vehicleReference) || publicVehicles.length === 0) return;
    navigate(`${getVehicleCanonicalPath(vehicle, publicVehicles)}${location.search}`, { replace: true });
  }, [location.search, navigate, publicVehicles, vehicle, vehicleReference]);

  if (isLoading) {
    return (
      <MainLayout variant="vehicle">
        <div className="container pt-36 pb-24 text-center lg:pt-44">
          <h1 className="font-display text-2xl font-medium uppercase tracking-[0.08em] text-white">Loading vehicle</h1>
        </div>
      </MainLayout>
    );
  }

  if (!vehicle) {
    return (
      <MainLayout variant="vehicle">
        <div className="container pt-36 pb-24 text-center lg:pt-44">
          <h1 className="mb-6 font-display text-2xl font-medium uppercase tracking-[0.08em] text-white">Vehicle not found</h1>
          <Button className="zonyx-vehicle-primary rounded-none uppercase tracking-[0.12em]" asChild>
            <Link to="/fleet">Back to Fleet</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  const heroImage = vehicle.image_url || vehicle.images?.[0] || "/placeholder.svg";
  const galleryImages = Array.from(new Set([vehicle.image_url, ...(vehicle.images ?? [])].filter((image): image is string => Boolean(image))));
  const displayImages = galleryImages.length > 0 ? galleryImages : ["/placeholder.svg"];
  const supportingImages = displayImages.slice(1, 3);
  const remainingImages = displayImages.slice(3);
  const vehicleName = `${vehicle.year} ${vehicle.brand} ${vehicle.name}`;
  const vehicleUrl = getVehicleCanonicalPath(vehicle, publicVehicles);
  const vehicleImage = heroImage.startsWith("http") ? heroImage : `https://www.gozonyx.com${heroImage}`;
  const vehicleDescription = `Rent the ${vehicleName} in Miami with ZONYX. View rental pricing, vehicle details and availability.`;
  const vehicleStructuredData = { "@context": "https://schema.org", "@type": "Car", name: vehicleName, brand: { "@type": "Brand", name: vehicle.brand }, image: vehicleImage, category: vehicle.category, offers: { "@type": "Offer", businessFunction: "https://schema.org/LeaseOut", priceSpecification: { "@type": "UnitPriceSpecification", priceCurrency: "USD", price: (vehicle.base_daily_rate_cents / 100).toFixed(2), referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" } }, url: `https://www.gozonyx.com${vehicleUrl}` } };

  return (
    <MainLayout variant="vehicle">
      <Seo title={`${vehicleName} Rental in Miami | ZONYX`} description={vehicleDescription} path={vehicleUrl} image={vehicleImage} structuredData={vehicleStructuredData} />
      <section className="zonyx-vehicle-content pb-24 pt-32 md:pt-36 lg:pb-32 xl:pt-44">
        <div className="mx-auto max-w-[1536px] px-5 sm:px-8 lg:px-12">
          <Link to="/fleet" className="zonyx-vehicle-back mb-8 inline-flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55 transition-colors hover:text-[hsl(var(--home-teal))] focus-visible:outline-none focus-visible:text-[hsl(var(--home-teal))] lg:mb-10">
            <ArrowLeft className="h-4 w-4" />
            Back to Fleet
          </Link>

          <div className={`zonyx-vehicle-gallery ${supportingImages.length > 0 ? "has-supporting-images" : ""}`}>
            <div className="zonyx-vehicle-hero overflow-hidden bg-[#080b0c]">
              <img src={displayImages[0]} alt={vehicle.name} className="h-full w-full object-cover" />
            </div>
            {supportingImages.length > 0 && (
              <div className="zonyx-vehicle-supporting-grid">
                {supportingImages.map((image, index) => (
                  <div key={image} className="zonyx-vehicle-supporting-image overflow-hidden bg-[#080b0c]">
                    <img src={image} alt={`${vehicle.name} view ${index + 2}`} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {remainingImages.length > 0 && (
            <div className="mt-5 border-b border-white/10 pb-5 text-right">
              <button type="button" aria-expanded={showAllImages} onClick={() => setShowAllImages((current) => !current)} className="zonyx-vehicle-gallery-toggle inline-flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/65 transition-colors hover:text-[hsl(var(--home-teal))] focus-visible:outline-none">
                {showAllImages ? "Show fewer images" : `View all ${displayImages.length} images`}
                <ArrowRight className={`h-4 w-4 transition-transform ${showAllImages ? "rotate-90" : ""}`} />
              </button>
            </div>
          )}

          {showAllImages && remainingImages.length > 0 && (
            <div className="zonyx-vehicle-expanded-gallery mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {remainingImages.map((image, index) => (
                <div key={image} className="aspect-[4/3] overflow-hidden bg-[#080b0c]">
                  <img src={image} alt={`${vehicle.name} view ${index + 4}`} className="h-full w-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          )}

          <div className="mt-12 grid grid-cols-1 gap-12 lg:mt-16 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.48fr)] lg:gap-20 xl:gap-28">
            <div>
              <p className="zonyx-vehicle-eyebrow">{vehicle.brand}</p>
              <h1 className="zonyx-vehicle-title mt-4">{vehicle.year} {vehicle.name}</h1>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs uppercase tracking-[0.15em] text-white/55">
                <span>{vehicle.category}</span>
                <span className="h-1 w-1 bg-[hsl(var(--home-teal))]" aria-hidden />
                <span className="text-[hsl(var(--home-teal))]">Active vehicle</span>
              </div>

              <p className="mt-8 max-w-2xl text-base leading-8 text-white/58">
                Rent this {vehicleName} through ZONYX in Miami. Identifier {vehicle.vehicle_identifier}; availability and booking are managed through the ZONYX rental platform.
              </p>

              {host && (
                <div className="mt-10 border-t border-white/10 pt-6">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Host</p>
                  <p className="mt-2 text-base font-medium text-white/88">{host.full_name}</p>
                </div>
              )}

              <dl className="mt-10 grid grid-cols-1 border-y border-white/10 sm:grid-cols-3">
                <div className="zonyx-vehicle-spec py-5 sm:pr-6">
                  <dt>Color</dt>
                  <dd>{vehicle.color}</dd>
                </div>
                <div className="zonyx-vehicle-spec py-5 sm:border-l sm:border-white/10 sm:px-6">
                  <dt>Identifier</dt>
                  <dd>{vehicle.vehicle_identifier}</dd>
                </div>
                <div className="zonyx-vehicle-spec py-5 sm:border-l sm:border-white/10 sm:pl-6">
                  <dt>Category</dt>
                  <dd>{vehicle.category}</dd>
                </div>
              </dl>
            </div>

            <aside className="lg:border-l lg:border-white/10 lg:pl-10 xl:pl-14">
              <div className="flex items-end justify-between gap-5 border-b border-white/10 pb-7">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Daily rate</p>
                  <div className="mt-3 flex items-end gap-2">
                    <span className="text-4xl font-semibold tracking-tight text-white">{formatCurrencyFromCents(vehicle.base_daily_rate_cents)}</span>
                    <span className="pb-1 text-sm text-white/42">/day</span>
                  </div>
                </div>
                <span className="pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--home-teal))]">Available now</span>
              </div>

              <Button size="lg" asChild className="zonyx-vehicle-primary mt-7 w-full rounded-none uppercase tracking-[0.14em] shadow-none">
                <Link to={`/booking/${vehicle.id}${location.search}`}>Reserve and pay <ArrowRight /></Link>
              </Button>
            </aside>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}