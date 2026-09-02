import { Mail, Phone, MessageCircle, MapPin, Globe } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useLanguage } from "@/contexts/LanguageContext";
import whatsappQR from "@/assets/whatsapp-qr-cropped.png";
import { businessStructuredData, Seo } from "@/components/seo/Seo";
export default function Contact() {
  const {
    t
  } = useLanguage();
  const contactMethods = [{
    icon: Mail,
    title: "Email",
    value: "support@gozonyx.com",
    href: "mailto:support@gozonyx.com",
    description: "Contact our team directly"
  }, {
    icon: Phone,
    title: "Phone",
    value: "+1 305 615 5237",
    href: "tel:+13056155237",
    description: "Call us anytime"
  }, {
    icon: Globe,
    title: "Website",
    value: "gozonyx.com",
    href: "https://gozonyx.com",
    description: "Visit our website"
  }, {
    icon: MapPin,
    title: "Location",
    address: "601 Brickell Key Dr #11, Miami, FL 33131 United States",
    value: "Visit Our Office",
    href: "https://maps.google.com/?q=601+Brickell+Key+Dr+%2311,+Miami,+FL+33131",
    description: "Find us on the map"
  }];
  return <MainLayout>
      <Seo title="Contact ZONYX | Electric Vehicle Rentals Miami" description="Contact ZONYX for premium Tesla, Cybertruck and electric vehicle rentals in Miami and South Florida." path="/contact" image="https://www.gozonyx.com/favicon-v2.png" structuredData={businessStructuredData} />
      <div className="min-h-screen pt-24 pb-20">
        <div className="container">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-wide mb-4">
              {t("nav.contact")}
            </h1>
            <p className="font-display text-muted-foreground max-w-2xl mx-auto tracking-wide text-xs">
              Get In Touch Our Team Is Here For You          
            </p>
          </div>

          {/* Contact Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {contactMethods.map(method => <a key={method.title} href={method.href} target={method.href.startsWith("http") ? "_blank" : undefined} rel={method.href.startsWith("http") ? "noopener noreferrer" : undefined} className="group glass p-8 rounded-lg hover:border-primary/50 transition-all duration-300 hover:glow">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <method.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-semibold tracking-wide mb-1">
                      {method.title}
                    </h3>
                    {method.address && <p className="font-display text-sm text-muted-foreground tracking-wide mb-2">
                        {method.address}
                      </p>}
                    <p className="font-display text-primary text-lg tracking-wide mb-2">
                      {method.value}
                    </p>
                    <p className="font-display text-sm text-muted-foreground tracking-wide">
                      {method.description}
                    </p>
                  </div>
                </div>
              </a>)}

            {/* WhatsApp Card with QR Code */}
            <a href="https://wa.me/18005550199" target="_blank" rel="noopener noreferrer" className="group glass p-8 rounded-lg hover:border-primary/50 transition-all duration-300 hover:glow flex flex-col items-center justify-center">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <h3 className="font-display text-lg font-semibold tracking-wide">
                  WhatsApp
                </h3>
              </div>
              <div className="w-32 h-32 rounded overflow-hidden flex items-center justify-center">
                <img src={whatsappQR} alt="Scan to chat on WhatsApp" className="w-full h-full object-contain" />
              </div>
              <p className="text-sm tracking-wide mt-4 text-primary font-sans text-center">
                Scan QR Code to Chat
              </p>
            </a>
          </div>

          {/* Additional Info */}
          <div className="text-center mt-16">
            <p className="tracking-wide text-primary font-sans">
              PREMIUM EV EXPERIENCE AVAILIBLE 24/7 
            </p>
          </div>
        </div>
      </div>
    </MainLayout>;
}