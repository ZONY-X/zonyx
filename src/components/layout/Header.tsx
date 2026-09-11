import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Menu, X, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AccountModeSwitcher } from "@/components/account/AccountModeSwitcher";
import { useAccountMode } from "@/contexts/AccountModeContext";
import { routeForAccountMode } from "@/lib/accountMode";
import zonyxHorizontalLogo from "@/assets/zonyx-horizontal-logo.png";
export function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const {
    user,
    signOut
  } = useAuth();
  const { mode } = useAccountMode();
  const {
    t
  } = useLanguage();
  
  // Route to appropriate dashboard based on user role
  const dashboardRoute = routeForAccountMode(mode);
  const navLinks = [{
    href: "/",
    label: t("nav.home")
  }, {
    href: "/fleet",
    label: t("nav.fleet")
  }, {
    href: "/contact",
    label: t("nav.contact")
  }];
  const handleSignOut = async () => {
    await signOut();
    setMobileMenuOpen(false);
  };
  return <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-transparent">
        {/* Desktop: public navigation and authenticated workspace controls have separate visual rows. */}
        <div className="hidden xl:block font-ui">
          <div className="relative h-16">
            <Link to="/" className="absolute left-4 top-0 flex h-16 items-center overflow-visible p-0 2xl:left-8">
              <img src={zonyxHorizontalLogo} alt="ZONYX" className="-ml-2 h-24 w-auto object-contain" />
            </Link>
            <div className="absolute left-1/2 top-0 flex h-16 -translate-x-1/2 items-center justify-center gap-6">
              <nav className="flex items-center gap-6">
                {navLinks.map(link => <Link key={link.href} to={link.href} className={cn("text-sm font-medium uppercase tracking-[0.08em] transition-colors", location.pathname === link.href ? "text-primary" : "text-muted-foreground")}>
                    {link.label}
                  </Link>)}
              </nav>
              <LanguageSwitcher />
            </div>
          </div>
          {user ? <div className="border-t border-border/40 bg-background/55 backdrop-blur-md">
              <div className="container flex h-12 items-center justify-center gap-5">
                <AccountModeSwitcher />
                <span className="h-5 w-px bg-border" aria-hidden />
                <Button variant="ghost" size="sm" className="text-xs uppercase tracking-[0.08em]" asChild>
                  <Link to={dashboardRoute}>DASHBOARD</Link>
                </Button>
                <Button variant="ghost" size="sm" className="text-xs uppercase tracking-[0.08em]" onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("auth.signOut")}
                </Button>
              </div>
            </div> : <div className="container flex h-12 items-center justify-center gap-3">
              <Button size="sm" className="bg-black text-primary hover:bg-black/90" asChild>
                <Link to="/auth">{t("auth.signIn")}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/host-dashboard">{t("auth.getStarted")}</Link>
              </Button>
            </div>}
        </div>

        {/* Existing mobile/tablet header */}
        <div className="container flex h-20 items-center justify-between md:h-24 xl:hidden">
          <Link to="/" className="flex h-16 items-center overflow-hidden p-0">
            <img src={zonyxHorizontalLogo} alt="ZONYX" className="h-20 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && <div className="xl:hidden glass-strong border-t border-border">
            <nav className="container py-4 flex flex-col gap-4">
              {navLinks.map(link => <Link key={link.href} to={link.href} onClick={() => setMobileMenuOpen(false)} className={cn("text-sm font-medium py-2 transition-colors hover:text-primary", location.pathname === link.href ? "text-primary" : "text-muted-foreground")}>
                  {link.label}
                </Link>)}
              <div className="flex flex-col gap-2 pt-4 border-t border-border">
                {user ? <>
                    <AccountModeSwitcher mobile />
                    <Button variant="outline" asChild>
                      <Link to={dashboardRoute} onClick={() => setMobileMenuOpen(false)}>DASHBOARD</Link>
                    </Button>
                    <Button variant="outline" onClick={handleSignOut}>
                      <LogOut className="w-4 h-4 mr-2" />
                      {t("auth.signOut")}
                    </Button>
                  </> : <>
                    <Button variant="outline" asChild>
                      <Link to="/auth">{t("auth.signIn")}</Link>
                    </Button>
                    <Button asChild>
                      <Link to="/host-dashboard">{t("auth.getStarted")}</Link>
                    </Button>
                  </>}
              </div>
            </nav>
          </div>}
      </header>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-t border-border">
        <div className="container flex items-center justify-center gap-12 h-14">
          {navLinks.map(link => <Link key={link.href} to={link.href} className={cn("text-sm font-medium transition-colors hover:text-primary", location.pathname === link.href ? "text-primary" : "text-muted-foreground")}>
              {link.label}
            </Link>)}
        </div>
      </nav>
    </>;
}