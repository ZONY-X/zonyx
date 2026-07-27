import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Check, MapPin, ShieldCheck, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export interface Vehicle {
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
  available: boolean;
  host?: string;
  rating?: number;
  trips?: number;
  location?: string;
  verified?: boolean;
  superhost?: boolean;
  description?: string;
  features?: string[];
  pickupArea?: string;
  instantBook?: boolean;
  airportDelivery?: boolean;
  addOns?: Array<{ title: string; price: number; description: string }>;
}

interface VehicleCardProps extends React.HTMLAttributes<HTMLDivElement> {
  vehicle: Vehicle;
  className?: string;
}

export function VehicleCard({
  vehicle,
  className,
  ...props
}: VehicleCardProps) {
  const allImages = vehicle.images?.length ? vehicle.images : [vehicle.imageUrl];
  const [currentIndex, setCurrentIndex] = useState(0);

  const goToPrevious = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentIndex((prev) => (prev === 0 ? allImages.length - 1 : prev - 1));
  };

  const goToNext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentIndex((prev) => (prev === allImages.length - 1 ? 0 : prev + 1));
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card/90 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl",
        className
      )}
      {...props}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={allImages[currentIndex]}
          alt={vehicle.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {!vehicle.available && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <span className="text-sm font-semibold text-muted-foreground">Not Available</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-background/10 to-transparent" />

        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          {vehicle.superhost && (
            <span className="rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
              Superhost
            </span>
          )}
          {vehicle.instantBook && (
            <span className="rounded-full bg-primary/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground">
              Instant Book
            </span>
          )}
          {vehicle.airportDelivery && (
            <span className="rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
              Airport Delivery
            </span>
          )}
        </div>

        {allImages.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm opacity-0 transition-opacity duration-300 hover:bg-background group-hover:opacity-100"
            >
              <ChevronLeft className="h-4 w-4 text-foreground" />
            </button>
            <button
              onClick={goToNext}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm opacity-0 transition-opacity duration-300 hover:bg-background group-hover:opacity-100"
            >
              <ChevronRight className="h-4 w-4 text-foreground" />
            </button>

            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
              {allImages.map((_, index) => (
                <button
                  key={index}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCurrentIndex(index);
                  }}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    index === currentIndex ? "w-3 bg-primary" : "w-1.5 bg-foreground/60 hover:bg-foreground/80"
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="space-y-4 p-5">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">{vehicle.brand}</p>
              <h3 className="text-lg font-semibold text-foreground">{vehicle.name}</h3>
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold text-primary">${vehicle.pricePerDay}</p>
              <p className="text-xs text-muted-foreground">/day</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {vehicle.location ?? "Miami"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
              <Star className="h-3.5 w-3.5 fill-primary text-primary" />
              {vehicle.rating?.toFixed(2) ?? "4.9"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {vehicle.trips ?? 0} trips
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {vehicle.verified ? <ShieldCheck className="h-4 w-4 text-primary" /> : <Check className="h-4 w-4 text-primary" />}
            <span>{vehicle.host ? `Hosted by ${vehicle.host}` : "Trusted host"}</span>
          </div>
          <Button size="sm" variant="outline" asChild disabled={!vehicle.available}>
            <Link to={`/vehicle/${vehicle.id}`}>View Details</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
