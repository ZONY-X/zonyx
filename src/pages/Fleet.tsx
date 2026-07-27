import { MainLayout } from "@/components/layout/MainLayout";
import { VehicleCard, Vehicle } from "@/components/vehicles/VehicleCard";
import { useLanguage } from "@/contexts/LanguageContext";
import model3FsdImage from "@/assets/cars/model3-fsd.jpg";
import cybertruckImage from "@/assets/cars/cybertruck-fsd.png";
import cayenneSideImage from "@/assets/cars/cayenne-side.jpg";
import cayenneRearImage from "@/assets/cars/cayenne-rear.jpg";
import cayenneInteriorImage from "@/assets/cars/cayenne-interior.jpg";
import porscheTaycanImage from "@/assets/cars/porsche-taycan-green.jpg";
import porscheTaycanWheelImage from "@/assets/cars/porsche-taycan-wheel.jpg";
const vehicles: Vehicle[] = [{
  id: "1",
  name: "2025 Tesla Cybertruck AWD",
  host: "Zo",
  rating: 5.0,
  trips: 38,
  location: "Miami",
  verified: true,
  superhost: true,
  brand: "Tesla",
  category: "Electric Pickup",
  pricePerDay: 249,
  imageUrl: cybertruckImage,
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true,
  instantBook: true,
  airportDelivery: true,
}, {
  id: "2",
  name: "2025 Tesla Model 3",
  host: "Miguel",
  rating: 4.98,
  trips: 21,
  location: "Miami",
  verified: true,
  superhost: false,
  brand: "Tesla",
  category: "Electric Sedan",
  pricePerDay: 129,
  imageUrl: model3FsdImage,
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true,
  instantBook: true,
  airportDelivery: false,
}, {
  id: "3",
  name: "2025 Rivian R1S",
  host: "Jim",
  rating: 4.97,
  trips: 17,
  location: "Fort Lauderdale",
  verified: true,
  superhost: false,
  brand: "Rivian",
  category: "Electric SUV",
  pricePerDay: 219,
  imageUrl: cayenneSideImage,
  images: [cayenneSideImage, cayenneRearImage, cayenneInteriorImage],
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true,
  instantBook: true,
  airportDelivery: true,
}, {
  id: "4",
  name: "2025 Porsche Macan EV",
  host: "Alex",
  rating: 4.9,
  trips: 0,
  location: "Homestead",
  verified: false,
  superhost: false,
  brand: "Porsche",
  category: "Electric SUV",
  pricePerDay: 329,
  imageUrl: porscheTaycanImage,
  images: [porscheTaycanImage, porscheTaycanWheelImage],
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true,
  instantBook: false,
  airportDelivery: false,
}, {
  id: "5",
  name: "2025 Lucid Air Touring",
  host: "Juan Manuel",
  rating: 5.0,
  trips: 8,
  location: "Miami",
  verified: true,
  superhost: true,
  brand: "Lucid",
  category: "Electric Sedan",
  pricePerDay: 269,
  imageUrl: model3FsdImage,
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true,
  instantBook: true,
  airportDelivery: false,
}, {
  id: "6",
  name: "Mercedes-Benz G580 EQ",
  host: "Elisa",
  rating: 4.99,
  trips: 12,
  location: "Miami",
  verified: true,
  superhost: false,
  brand: "Mercedes-Benz",
  category: "Electric SUV",
  pricePerDay: 389,
  imageUrl: cayenneSideImage,
  images: [cayenneSideImage, cayenneRearImage, cayenneInteriorImage],
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true,
  instantBook: true,
  airportDelivery: true,
}];
export default function Fleet() {
  const {
    t
  } = useLanguage();
  return <MainLayout>
      <section className="pt-24 pb-20">
        <div className="container">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-primary mb-4">
              {t("fleet.title")}
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Our Collection of Premium Electric Vehicles Available  
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {vehicles.map((vehicle, index) => <VehicleCard key={vehicle.id} vehicle={vehicle} className="animate-slide-up" style={{
            animationDelay: `${index * 100}ms`
          } as React.CSSProperties} />)}
          </div>
        </div>
      </section>
    </MainLayout>;
}