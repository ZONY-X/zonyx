import { Link } from "react-router-dom";
import { Facebook, Instagram, Mail, MapPin } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import zonyxLogoTransparent from "@/assets/zonyx-logo-transparent.png";
import zonyxOfficialLogo from "@/assets/zonyx-official-logo.png";
import appStoreBadge from "@/assets/app-store-badge.svg";
import googlePlayBadge from "@/assets/google-play-badge.png";

export function Footer({ variant = "default" }: { variant?: "default" | "fleet" }) {
  const {
    t
  } = useLanguage();
  const footerLinks = {
    support: [{
      label: "Contact Our Team",
      href: "mailto:support@gozonyx.com",
      isExternal: true
    }, {
      label: "+1 305 615 5237",
      href: "tel:+13056155237",
      isExternal: true
    }, {
      label: "Website",
      href: "https://gozonyx.com",
      isExternal: true
    }],
    legal: [{
      label: t("footer.terms"),
      href: "/terms"
    }]
  };
  const fleetVariant = variant === "fleet";
  if (fleetVariant) {
    return <footer className="zonyx-fleet-footer bg-[#020506] px-6 py-9 sm:px-10 lg:px-14">
      <div className="mx-auto flex max-w-[1536px] flex-col items-center gap-8 lg:flex-row lg:justify-between">
        <Link to="/" className="w-44"><img src={zonyxOfficialLogo} alt="ZONYX" className="h-auto w-full" /></Link>
        <nav aria-label="Footer navigation" className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-[10px] font-semibold uppercase tracking-[0.14em]">
          <Link to="/fleet">Fleet</Link>
          <Link to="/#how-it-works">How it works</Link>
          <Link to="/become-host">Be a host</Link>
          <Link to="/#about">About</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/terms">{t("footer.terms")}</Link>
        </nav>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
          <div className="-mt-[3.5px] -mb-[6.5px] flex flex-col items-center justify-center gap-[15px] lg:max-xl:-mb-[3.5px] lg:max-xl:min-h-[104.5px] lg:max-xl:translate-x-[5.90625px] lg:max-xl:translate-y-[1.5px] xl:-translate-x-[calc(clamp(1.25rem,calc((100vw-1198px)/4),5.3rem)-9.65625px)]" role="group" aria-label="ZONYX apps arriving soon">
            <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/55">Arriving soon</span>
            <div className="flex flex-nowrap items-center justify-center gap-2">
              <img src={appStoreBadge} alt="Apple App Store — arriving soon" className="h-[37px] w-auto" />
              <img src={googlePlayBadge} alt="Google Play — arriving soon" className="h-[55px] w-auto -my-[9px]" />
            </div>
          </div>
          <span className="hidden h-9 w-px bg-white/30 sm:block" />
          <a href="https://www.instagram.com/gozonyx" target="_blank" rel="noreferrer" aria-label="Instagram"><Instagram /></a>
          <span className="hidden h-9 w-px bg-white/30 xl:block" />
          <p className="hidden text-[10px] uppercase leading-5 tracking-[0.22em] text-white/80 xl:block">Access more,<br />on the road.</p>
        </div>
      </div>
    </footer>;
  }
  return <footer className={fleetVariant ? "zonyx-fleet-footer border-t border-white/10 bg-[#020506]" : "border-t border-border bg-card/50"}>
      <div className="container py-12 md:py-16">
        <div className="flex flex-col items-center gap-3">
          {/* Social Icons */}
          <div className="flex items-center gap-6 border-primary">
            <a href="https://gozonyx.com" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
              <Facebook className="w-5 h-5" />
            </a>
            <a href="https://maps.google.com/?q=601+Brickell+Key+Dr+%2311,+Miami,+FL+33131" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
              <MapPin className="w-5 h-5" />
            </a>
            <a href="https://gozonyx.com" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
              <Instagram className="w-5 h-5" />
            </a>
            <a href="mailto:support@gozonyx.com" className="text-muted-foreground hover:text-primary transition-colors">
              <Mail className="w-5 h-5" />
            </a>
          </div>
          
          {/* Centered Logo */}
          <Link to="/" className="flex items-center justify-center p-0">
            <img src={fleetVariant ? zonyxOfficialLogo : zonyxLogoTransparent} alt="ZONYX Logo" className={fleetVariant ? "h-auto w-44 object-contain" : "h-20 md:h-24 w-auto object-contain"} />
          </Link>
          
          <p className="text-sm text-center w-full tracking-wide font-mono text-primary">
            {t("footer.tagline")}
          </p>

          {/* Links - Centered below logo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 w-full text-center max-w-xl mx-auto">

            <div>
              <h4 className="font-display font-semibold text-foreground mb-2 tracking-wide text-xs">{t("footer.support")}</h4>
              <ul className="space-y-1">
                {footerLinks.support.map(link => <li key={link.href} className="font-display">
                    {link.isExternal ? <a href={link.href} className="text-xs text-muted-foreground hover:text-primary transition-colors tracking-wide">
                        {link.label}
                      </a> : <Link to={link.href} className="text-xs text-muted-foreground hover:text-primary transition-colors tracking-wide">
                        {link.label}
                      </Link>}
                  </li>)}
              </ul>
            </div>

            <div>
              <h4 className="font-display font-semibold text-foreground mb-2 tracking-wide text-xs">{t("footer.legal")}</h4>
              <ul className="space-y-1">
                {footerLinks.legal.map(link => <li key={link.href} className="font-display">
                    <Link to={link.href} className="text-xs text-muted-foreground hover:text-primary transition-colors tracking-wide">
                      {link.label}
                    </Link>
                  </li>)}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </footer>;
}