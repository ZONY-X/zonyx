import { Header } from "./Header";
import { Footer } from "./Footer";

interface MainLayoutProps {
  children: React.ReactNode;
  showFooter?: boolean;
  variant?: "default" | "fleet" | "booking";
}

export function MainLayout({ children, showFooter = true, variant = "default" }: MainLayoutProps) {
  const usesBrandShell = variant === "fleet" || variant === "booking";
  return (
    <div className={variant === "booking" ? "zonyx-fleet zonyx-booking min-h-screen flex flex-col" : variant === "fleet" ? "zonyx-fleet min-h-screen flex flex-col" : "min-h-screen flex flex-col"}>
      <Header variant={usesBrandShell ? "fleet" : "default"} />
      <main className="flex-1">{children}</main>
      {showFooter && <Footer variant={usesBrandShell ? "fleet" : "default"} />}
    </div>
  );
}
