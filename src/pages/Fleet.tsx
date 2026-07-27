import { MainLayout } from "@/components/layout/MainLayout";
import { VehicleCard } from "@/components/vehicles/VehicleCard";
import { useLanguage } from "@/contexts/LanguageContext";
import { mockVehicles } from "@/lib/vehicles";

export default function Fleet() {
  const { t } = useLanguage();

  return (
    <MainLayout>
      <section className="pt-24 pb-20">
        <div className="container max-w-7xl">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-primary">Premium marketplace</p>
            <h1 className="mb-4 text-4xl font-semibold text-foreground md:text-5xl">
              {t("fleet.title")}
            </h1>
            <p className="text-base leading-7 text-muted-foreground md:text-lg">
              Curated EV rentals with elevated hospitality, verified hosts, and a concierge-style booking experience.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {mockVehicles.map((vehicle, index) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                className="animate-slide-up"
                style={{ animationDelay: `${index * 100}ms` } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
      </section>
    </MainLayout>
  );
}