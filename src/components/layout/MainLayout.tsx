import { Header } from "./Header";
import { Footer } from "./Footer";

interface MainLayoutProps {
  children: React.ReactNode;
  showFooter?: boolean;
  variant?: "default" | "fleet";
}

export function MainLayout({ children, showFooter = true, variant = "default" }: MainLayoutProps) {
  return (
    <div className={variant === "fleet" ? "zonyx-fleet min-h-screen flex flex-col" : "min-h-screen flex flex-col"}>
      <Header variant={variant === "fleet" ? "fleet" : "default"} />
      <main className="flex-1">{children}</main>
      {showFooter && <Footer variant={variant} />}
    </div>
  );
}
