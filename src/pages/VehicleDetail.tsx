import { useParams, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, Gauge, Fuel, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
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
    name: "MODEL 3",
    brand: "Tesla",
    category: "Electric",
    pricePerDay: 89,
    imageUrl: model3FsdImage,
    images: [model3FsdImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    description: "The Tesla Model 3 is an electric four-door sedan with minimalist interior, autopilot capabilities, and impressive range. Perfect for eco-conscious drivers who want cutting-edge technology.",
    features: ["Autopilot", "15\" Touchscreen", "Premium Audio", "Glass Roof", "Wireless Charging"],
  },
  {
    id: "2",
    name: "CYBERTRUCK",
    brand: "Tesla",
    category: "Truck",
    pricePerDay: 149,
    imageUrl: cybertruckImage,
    images: [cybertruckImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    description: "The Tesla Cybertruck is a revolutionary all-electric pickup with an exoskeleton design, bulletproof glass, and unmatched towing capacity. A bold statement on wheels.",
    features: ["Adaptive Air Suspension", "Vault Storage", "Armor Glass", "FSD Capability", "17\" Display"],
  },
  {
    id: "3",
    name: "NEW CAYENNE EV",
    brand: "Porsche",
    category: "Electric SUV",
    pricePerDay: 379,
    imageUrl: cayenneSideImage,
    images: [cayenneSideImage, cayenneRearImage, cayenneInteriorImage],
    seats: 5,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    description: "The Porsche Cayenne EV combines legendary Porsche performance with zero-emission driving. Luxurious interior, powerful acceleration, and the latest tech make it the ultimate electric SUV.",
    features: ["Porsche Active Suspension", "Bose Surround Sound", "Panoramic Roof", "Matrix LED Lights", "Sport Chrono Package"],
  },
  {
    id: "4",
    name: "TAYCAN",
    brand: "Porsche",
    category: "Electric",
    pricePerDay: 349,
    imageUrl: porscheTaycanImage,
    images: [porscheTaycanImage, porscheTaycanWheelImage],
    seats: 4,
    transmission: "automatic",
    fuelType: "Electric",
    available: true,
    description: "The Porsche Taycan delivers electrifying performance with the soul of a sports car. Stunning design, blistering acceleration, and cutting-edge technology in a sustainable package.",
    features: ["800V Architecture", "Curved Digital Display", "Performance Battery Plus", "Launch Control", "Adaptive Cruise Control"],
  },
];

export default function VehicleDetail() {
  const { id } = useParams();
  const vehicle = vehiclesData.find((v) => v.id === id);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  if (!vehicle) {
    return (
      <MainLayout>
        <div className="pt-24 pb-20 container text-center">
          <h1 className="text-2xl font-bold mb-4">Vehicle not found</h1>
          <Button asChild>
            <Link to="/fleet">Back to Fleet</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  const allImages = vehicle.images;

  const goToPrevious = () => {
    setCurrentImageIndex((prev) => (prev === 0 ? allImages.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentImageIndex((prev) => (prev === allImages.length - 1 ? 0 : prev + 1));
  };

  return (
    <MainLayout>
      <section className="pt-24 pb-20">
        <div className="container">
          {/* Back Button */}
          <Button variant="ghost" asChild className="mb-6">
            <Link to="/fleet">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Fleet
            </Link>
          </Button>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Image Gallery */}
            <div className="relative">
              <div className="aspect-[4/3] rounded-xl overflow-hidden bg-muted">
                <img
                  src={allImages[currentImageIndex]}
                  alt={vehicle.name}
                  className="w-full h-full object-cover"
                />
              </div>

              {allImages.length > 1 && (
                <>
                  <button
                    onClick={goToPrevious}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={goToNext}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}

              {/* Thumbnails */}
              {allImages.length > 1 && (
                <div className="flex gap-2 mt-4">
                  {allImages.map((img, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      className={cn(
                        "w-20 h-14 rounded-lg overflow-hidden border-2 transition-all",
                        index === currentImageIndex
                          ? "border-primary"
                          : "border-transparent opacity-60 hover:opacity-100"
                      )}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div>
              <p className="text-sm text-muted-foreground mb-1">{vehicle.brand}</p>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
                {vehicle.name}
              </h1>
              <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-sm mb-6">
                {vehicle.category}
              </span>

              <p className="text-muted-foreground mb-6">{vehicle.description}</p>

              {/* Specs */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-lg bg-card border border-border text-center">
                  <Users className="w-5 h-5 mx-auto mb-2 text-primary" />
                  <p className="text-sm text-muted-foreground">Seats</p>
                  <p className="font-semibold">{vehicle.seats}</p>
                </div>
                <div className="p-4 rounded-lg bg-card border border-border text-center">
                  <Gauge className="w-5 h-5 mx-auto mb-2 text-primary" />
                  <p className="text-sm text-muted-foreground">Transmission</p>
                  <p className="font-semibold capitalize">{vehicle.transmission}</p>
                </div>
                <div className="p-4 rounded-lg bg-card border border-border text-center">
                  <Fuel className="w-5 h-5 mx-auto mb-2 text-primary" />
                  <p className="text-sm text-muted-foreground">Fuel</p>
                  <p className="font-semibold">{vehicle.fuelType}</p>
                </div>
              </div>

              {/* Features */}
              <div className="mb-8">
                <h3 className="font-semibold mb-3">Features</h3>
                <div className="flex flex-wrap gap-2">
                  {vehicle.features.map((feature) => (
                    <span
                      key={feature}
                      className="px-3 py-1.5 rounded-full bg-muted text-sm text-foreground"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              </div>

              {/* Price & Book */}
              <div className="p-6 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-3xl font-bold text-primary">
                      ${vehicle.pricePerDay}
                    </span>
                    <span className="text-muted-foreground">/day</span>
                  </div>
                  <span
                    className={cn(
                      "px-3 py-1 rounded-full text-sm font-medium",
                      vehicle.available
                        ? "bg-green-500/10 text-green-500"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {vehicle.available ? "Available" : "Unavailable"}
                  </span>
                </div>
                <Button size="lg" className="w-full" disabled={!vehicle.available}>
                  <Calendar className="w-4 h-4 mr-2" />
                  Book Now
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}
