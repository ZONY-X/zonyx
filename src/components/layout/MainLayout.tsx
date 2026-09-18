import { Header } from "./Header";
import { Footer } from "./Footer";

interface MainLayoutProps {
  children: React.ReactNode;
  showFooter?: boolean;
  variant?: "default" | "fleet" | "vehicle" | "booking" | "app";
}

export function MainLayout({ children, showFooter = true, variant = "default" }: MainLayoutProps) {
  const usesBrandShell = variant === "fleet" || variant === "vehicle" || variant === "booking" || variant === "app";
  return (
    <div className={variant === "vehicle" ? "zonyx-fleet zonyx-vehicle-detail min-h-screen flex flex-col" : variant === "booking" ? "zonyx-fleet zonyx-booking min-h-screen flex flex-col" : variant === "app" ? "zonyx-fleet zonyx-app min-h-screen flex flex-col" : variant === "fleet" ? "zonyx-fleet min-h-screen flex flex-col" : "min-h-screen flex flex-col"}>
      <Header variant={usesBrandShell ? "fleet" : "default"} />
      <main className="flex-1">{children}</main>
      {showFooter && <Footer variant={usesBrandShell ? "fleet" : "default"} />}
    </div>
  );
}
