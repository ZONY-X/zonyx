import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Menu, X, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useHost } from "@/hooks/useHost";
import { useLanguage } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import zonyxHorizontalLogo from "@/assets/zonyx-horizontal-logo.png";
export function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const {
    user,
    signOut
  } = useAuth();
  const { isHost, isApproved } = useHost();
  const {
    t
  } = useLanguage();
  
  // Route to appropriate dashboard based on user role
  const dashboardRoute = isHost && isApproved ? "/host-dashboard" : "/guest-dashboard";
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
        <div className="container flex items-center justify-between h-20 md:h-24">
          <Link to="/" className="flex h-16 items-center overflow-hidden p-0">
            <img src={zonyxHorizontalLogo} alt="ZONYX" className="h-20 md:h-20 w-auto object-contain" />
          </Link>

          {/* Centered Navigation */}
          <div className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2 font-ui">
            <nav className="flex items-center gap-6">
              {navLinks.map(link => <Link key={link.href} to={link.href} className={cn("text-sm font-medium transition-colors text-muted-foreground", location.pathname === link.href ? "text-primary" : "text-muted-foreground")}>
                  {link.label}
                </Link>)}
            </nav>
            <LanguageSwitcher />
          </div>

          {/* Right side auth buttons */}
          <div className="hidden md:flex items-center gap-4 font-ui">
            {user ? <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to={dashboardRoute}>DASHBOARD</Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={handleSignOut}>
                  <LogOut className="w-4 h-4 mr-2" />
                  {t("auth.signOut")}
                </Button>
              </> : <>
                <Button size="sm" className="bg-black text-primary hover:bg-black/90" asChild>
                  <Link to="/auth">{t("auth.signIn")}</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/host-dashboard">{t("auth.getStarted")}</Link>
                </Button>
              </>}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 md:hidden">
            <LanguageSwitcher />
            <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && <div className="md:hidden glass-strong border-t border-border">
            <nav className="container py-4 flex flex-col gap-4">
              {navLinks.map(link => <Link key={link.href} to={link.href} onClick={() => setMobileMenuOpen(false)} className={cn("text-sm font-medium py-2 transition-colors hover:text-primary", location.pathname === link.href ? "text-primary" : "text-muted-foreground")}>
                  {link.label}
                </Link>)}
              <div className="flex flex-col gap-2 pt-4 border-t border-border">
                {user ? <>
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