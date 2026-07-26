import { Link } from "react-router-dom";
import { Facebook, Instagram, Mail, MapPin } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import zonyxLogoTransparent from "@/assets/zonyx-logo-transparent.png";
export function Footer() {
  const {
    t
  } = useLanguage();
  const footerLinks = {
    company: [{
      label: t("footer.aboutUs"),
      href: "/about"
    }, {
      label: t("footer.careers"),
      href: "/careers"
    }, {
      label: t("footer.press"),
      href: "/press"
    }],
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
    }, {
      label: t("footer.faq"),
      href: "/faq"
    }, {
      label: t("footer.helpCenter"),
      href: "/help"
    }],
    legal: [{
      label: t("footer.privacy"),
      href: "/privacy"
    }, {
      label: t("footer.terms"),
      href: "/terms"
    }, {
      label: t("footer.cookies"),
      href: "/cookies"
    }]
  };
  return <footer className="border-t border-border bg-card/50">
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
            <img src={zonyxLogoTransparent} alt="ZONYX Logo" className="h-20 md:h-24 w-auto object-contain" />
          </Link>
          
          <p className="text-sm text-center w-full tracking-wide font-mono text-primary">
            {t("footer.tagline")}
          </p>

          {/* Links - Centered below logo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 w-full text-center max-w-xl mx-auto">
            <div>
              <h4 className="font-display font-semibold text-foreground mb-2 tracking-wide text-xs">{t("footer.company")}</h4>
              <ul className="space-y-1">
                {footerLinks.company.map(link => <li key={link.href} className="font-display">
                    <Link to={link.href} className="text-xs text-muted-foreground hover:text-primary transition-colors tracking-wide">
                      {link.label}
                    </Link>
                  </li>)}
              </ul>
            </div>

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