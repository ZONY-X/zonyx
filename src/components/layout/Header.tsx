import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Menu, X, LogOut, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AccountModeSwitcher } from "@/components/account/AccountModeSwitcher";
import { useAccountMode } from "@/contexts/AccountModeContext";
import { routeForAccountMode } from "@/lib/accountMode";
import zonyxHorizontalLogo from "@/assets/zonyx-official-logo.png";

interface HeaderProps {
  variant?: "default" | "home" | "fleet";
  onRequestAccess?: () => void;
}

export function Header({ variant = "default", onRequestAccess }: HeaderProps) {
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
  if (variant === "fleet") {
    return <>
    <header className="zonyx-home-header fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-20 max-w-[1536px] items-center justify-between px-5 sm:px-8 lg:h-24 lg:px-12">
        <Link to="/" aria-label="ZONYX home" className="relative z-10 block w-[174px] sm:w-[205px] lg:w-[230px]">
          <img src={zonyxHorizontalLogo} alt="ZONYX" className="h-auto w-full object-contain" />
        </Link>

        <nav aria-label="Primary navigation" className="hidden items-center gap-7 lg:flex">
          {navLinks.map(link => <Link key={link.href} to={link.href} className={cn("zonyx-home-nav-link", location.pathname === link.href && "is-active")}>
            {link.label}
          </Link>)}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <LanguageSwitcher />
          {user ? <>
            <AccountModeSwitcher />
            <Button variant="outline" size="sm" className="rounded-full border-white/60 bg-black/20 uppercase tracking-[0.12em]" asChild>
              <Link to={dashboardRoute}>Dashboard</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}><LogOut className="h-4 w-4" />{t("auth.signOut")}</Button>
          </> : <>
            <Button variant="outline" size="sm" className="rounded-full border-white/60 bg-black/20 uppercase tracking-[0.12em]" asChild>
              <Link to="/auth">{t("auth.signIn")}</Link>
            </Button>
            <Button variant="outline" size="sm" className="zonyx-home-secondary rounded-full uppercase tracking-[0.12em]" asChild>
              <Link to="/host-dashboard">{t("auth.getStarted")}</Link>
            </Button>
          </>}
        </div>

        <Button aria-label={mobileMenuOpen ? "Close menu" : "Open menu"} variant="ghost" size="icon" className="relative z-10 text-white lg:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>

      {mobileMenuOpen && <div className="border-t border-white/10 bg-black/95 px-5 pb-7 pt-5 backdrop-blur-xl lg:hidden">
        <nav className="mx-auto flex max-w-lg flex-col gap-1">
          {navLinks.map(link => <Link key={link.href} to={link.href} onClick={() => setMobileMenuOpen(false)} className="zonyx-home-mobile-link">
            {link.label} <ArrowRight />
          </Link>)}
          <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-5">
            <LanguageSwitcher />
            {user ? <>
              <AccountModeSwitcher mobile />
              <Button variant="outline" className="rounded-full" asChild><Link to={dashboardRoute} onClick={() => setMobileMenuOpen(false)}>Dashboard</Link></Button>
              <Button variant="outline" className="rounded-full" onClick={handleSignOut}>{t("auth.signOut")}</Button>
            </> : <div className="flex gap-3">
              <Button variant="outline" className="flex-1 rounded-full" asChild><Link to="/auth" onClick={() => setMobileMenuOpen(false)}>{t("auth.signIn")}</Link></Button>
              <Button className="zonyx-home-primary flex-1 rounded-full" asChild><Link to="/host-dashboard" onClick={() => setMobileMenuOpen(false)}>{t("auth.getStarted")}</Link></Button>
            </div>}
          </div>
        </nav>
      </div>}
    </header>
    <nav aria-label="Mobile navigation" className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/90 backdrop-blur-lg lg:hidden">
      <div className="container flex h-14 items-center justify-center gap-12">
        {navLinks.map(link => <Link key={link.href} to={link.href} className={cn("text-sm font-medium transition-colors hover:text-[hsl(var(--home-teal))]", location.pathname === link.href ? "text-[hsl(var(--home-teal))]" : "text-white/60")}>
          {link.label}
        </Link>)}
      </div>
    </nav>
    </>;
  }
  if (variant === "home") {
    return <header className="zonyx-home-header fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-20 max-w-[1536px] items-center justify-between px-5 sm:px-8 lg:h-24 lg:px-12">
        <Link to="/" aria-label="ZONYX home" className="relative z-10 block w-[174px] sm:w-[205px] lg:w-[230px]">
          <img src={zonyxHorizontalLogo} alt="ZONYX" className="h-auto w-full object-contain" />
        </Link>

        <nav aria-label="Primary navigation" className="hidden items-center gap-7 lg:flex">
          <Link to="/fleet" className="zonyx-home-nav-link">Fleet</Link>
          <a href="#how-it-works" className="zonyx-home-nav-link">How it works</a>
          <Link to="/become-host" className="zonyx-home-nav-link">Be a host</Link>
          <a href="#about" className="zonyx-home-nav-link">About</a>
          <Link to="/contact" className="zonyx-home-nav-link">Contact</Link>
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <LanguageSwitcher />
          {user ? <>
            <Button variant="outline" size="sm" className="rounded-full border-white/60 bg-black/20 uppercase tracking-[0.12em]" asChild>
              <Link to={dashboardRoute}>Dashboard</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}><LogOut className="h-4 w-4" />{t("auth.signOut")}</Button>
          </> : <>
            <Button variant="outline" size="sm" className="rounded-full border-white/60 bg-black/20 uppercase tracking-[0.12em]" asChild>
              <Link to="/auth">Guest</Link>
            </Button>
            <Button variant="outline" size="sm" className="zonyx-home-secondary rounded-full uppercase tracking-[0.12em]" asChild>
              <Link to="/host-dashboard">Host</Link>
            </Button>
            <Button size="sm" className="zonyx-home-primary rounded-full px-6 uppercase tracking-[0.1em]" onClick={onRequestAccess}>
              Request access
            </Button>
          </>}
        </div>

        <Button aria-label={mobileMenuOpen ? "Close menu" : "Open menu"} variant="ghost" size="icon" className="relative z-10 text-white lg:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>

      {mobileMenuOpen && <div className="border-t border-white/10 bg-black/95 px-5 pb-7 pt-5 backdrop-blur-xl lg:hidden">
        <nav className="mx-auto flex max-w-lg flex-col gap-1">
          <Link to="/fleet" onClick={() => setMobileMenuOpen(false)} className="zonyx-home-mobile-link">Fleet <ArrowRight /></Link>
          <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="zonyx-home-mobile-link">How it works <ArrowRight /></a>
          <Link to="/become-host" onClick={() => setMobileMenuOpen(false)} className="zonyx-home-mobile-link">Be a host <ArrowRight /></Link>
          <a href="#about" onClick={() => setMobileMenuOpen(false)} className="zonyx-home-mobile-link">About <ArrowRight /></a>
          <Link to="/contact" onClick={() => setMobileMenuOpen(false)} className="zonyx-home-mobile-link">Contact <ArrowRight /></Link>
          <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-5">
            <LanguageSwitcher />
            {user ? <>
              <Button variant="outline" className="flex-1 rounded-full" asChild><Link to={dashboardRoute}>Dashboard</Link></Button>
              <Button variant="outline" className="flex-1 rounded-full" onClick={handleSignOut}>{t("auth.signOut")}</Button>
            </> : <>
              <Button variant="outline" className="flex-1 rounded-full" asChild><Link to="/auth">Guest</Link></Button>
              <Button className="zonyx-home-primary flex-1 rounded-full" onClick={() => { setMobileMenuOpen(false); onRequestAccess?.(); }}>Request access</Button>
            </>}
          </div>
        </nav>
      </div>}
    </header>;
  }
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