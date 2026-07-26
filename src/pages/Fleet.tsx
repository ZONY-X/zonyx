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
  name: "MODEL 3",
  brand: "Tesla",
  category: "Electric",
  pricePerDay: 89,
  imageUrl: model3FsdImage,
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true
}, {
  id: "2",
  name: "CYBERTRUCK",
  brand: "Tesla",
  category: "Truck",
  pricePerDay: 149,
  imageUrl: cybertruckImage,
  seats: 5,
  transmission: "automatic",
  fuelType: "Electric",
  available: true
}, {
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
  available: true
}, {
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
  available: true
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