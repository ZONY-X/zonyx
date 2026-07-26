import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Fuel, Users, Gauge, ChevronLeft, ChevronRight } from "lucide-react";
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
        "group relative rounded-xl overflow-hidden bg-card border border-border transition-all duration-300 hover:border-primary/50 hover:shadow-glow",
        className
      )}
      {...props}
    >
      {/* Image Gallery */}
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={allImages[currentIndex]}
          alt={vehicle.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        
        {!vehicle.available && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <span className="text-sm font-semibold text-muted-foreground">
              Not Available
            </span>
          </div>
        )}

        {/* Gallery Navigation */}
        {allImages.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-background"
            >
              <ChevronLeft className="w-4 h-4 text-foreground" />
            </button>
            <button
              onClick={goToNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-background"
            >
              <ChevronRight className="w-4 h-4 text-foreground" />
            </button>

            {/* Dots Indicator */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
              {allImages.map((_, index) => (
                <button
                  key={index}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCurrentIndex(index);
                  }}
                  className={cn(
                    "w-1.5 h-1.5 rounded-full transition-all duration-300",
                    index === currentIndex
                      ? "bg-primary w-3"
                      : "bg-foreground/50 hover:bg-foreground/70"
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1">{vehicle.brand}</p>
          <h3 className="text-lg font-semibold text-foreground">
            {vehicle.name}
          </h3>
        </div>

        {/* Specs */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            <span className="text-xs">{vehicle.seats}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Gauge className="w-3.5 h-3.5" />
            <span className="text-xs">{vehicle.transmission}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Fuel className="w-3.5 h-3.5" />
            <span className="text-xs">{vehicle.fuelType}</span>
          </div>
        </div>

        {/* Price and CTA */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div>
            <span className="text-xl font-bold text-primary">
              ${vehicle.pricePerDay}
            </span>
            <span className="text-xs text-muted-foreground">/day</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            asChild
            disabled={!vehicle.available}
          >
            <Link to={`/vehicle/${vehicle.id}`}>View Details</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
