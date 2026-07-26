import { createContext, useContext, useState, ReactNode } from "react";

type Language = "en" | "es";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations = {
  en: {
    // Header
    "nav.home": "HOME",
    "nav.fleet": "FLEET",
    "nav.contact": "CONTACT",
    "auth.signIn": "GUEST",
    "auth.signOut": "SIGN OUT",
    "auth.getStarted": "HOST",
    
    // Hero
    "hero.ownLess": "Own Less",
    "hero.accessMore": "Access MORE",
    "hero.tagline": "EXPERIENCE THE FUTURE / RIDE GREENER",
    "hero.selectRide": "EXPLORE VEHICLES",
    
    // Search Form
    "search.location": "LOCATION",
    "search.pickupLocation": "Pick-up location",
    "search.pickupDate": "TRIP START DATE",
    "search.returnDate": "TRIP END DATE",
    "search.selectDate": "Select date",
    "search.search": "Search",
    
    // Features
    "features.flexible": "FLEXIBLE",
    "features.flexibleDesc": "ADJUSTABLE TO EXPERIENCE",
    "features.support": "24/7 SUPPORT",
    "features.supportDesc": "MORE DIRECT MORE PEACE OF MIND",
    "features.noFees": "NO EXTRA FEES",
    "features.noFeesDesc": "NO HIDDEN PLATFORM FEES",
    "features.private": "MORE PRIVATE",
    "features.privateDesc": "MORE COMFORT MORE EXCLUSIVE",
    
    // Fleet
    "fleet.title": "OUR FLEET",
    "fleet.viewAll": "View All",
    "fleet.perDay": "/day",
    "fleet.bookNow": "Book Now",
    
    // Testimonials
    "testimonials.label": "TESTIMONIALS",
    "testimonials.title": "CUSTOMER EXPERIENCE",
    
    // Rental Upload
    "rental.label": "DOCUMENT YOUR RENTAL",
    "rental.title": "BEFORE & AFTER PHOTOS",
    "rental.description": "Upload vehicle condition photos for a smooth rental experience",
    
    // CTA
    "cta.title": "READY TO HIT THE ROAD?",
    "cta.description": "JOIN ZONYX FOR YOUR PREMIUM ELECTRIC CAR RENTAL NEEDS.",
    "cta.button": "START YOUR TRIP",
    
    // Footer
    "footer.tagline": "EXPERIENCE THE FUTURE GREENER",
    "footer.company": "COMPANY",
    "footer.support": "SUPPORT",
    "footer.legal": "LEGAL",
    "footer.aboutUs": "About Us",
    "footer.careers": "Careers",
    "footer.press": "Press",
    "footer.contact": "Contact",
    "footer.faq": "FAQ",
    "footer.helpCenter": "Help Center",
    "footer.privacy": "Privacy Policy",
    "footer.terms": "Terms of Service",
    "footer.cookies": "Cookie Policy",
  },
  es: {
    // Header
    "nav.home": "INICIO",
    "nav.fleet": "FLOTA",
    "nav.contact": "CONTACTO",
    "auth.signIn": "INVITADO",
    "auth.signOut": "CERRAR SESIÓN",
    "auth.getStarted": "ANFITRIÓN",
    
    // Hero
    "hero.ownLess": "Posee Menos",
    "hero.accessMore": "Accede a MÁS",
    "hero.tagline": "EXPERIMENTA EL FUTURO / CONDUCE MÁS VERDE",
    "hero.selectRide": "EXPLORAR VEHÍCULOS",
    
    // Search Form
    "search.location": "UBICACIÓN",
    "search.pickupLocation": "Lugar de recogida",
    "search.pickupDate": "FECHA DE INICIO",
    "search.returnDate": "FECHA DE FIN",
    "search.selectDate": "Seleccionar fecha",
    "search.search": "Buscar",
    
    // Features
    "features.flexible": "FLEXIBLE",
    "features.flexibleDesc": "ADAPTABLE A TU EXPERIENCIA",
    "features.support": "SOPORTE 24/7",
    "features.supportDesc": "MÁS DIRECTO MÁS TRANQUILIDAD",
    "features.noFees": "SIN CARGOS EXTRA",
    "features.noFeesDesc": "SIN COMISIONES OCULTAS",
    "features.private": "MÁS PRIVADO",
    "features.privateDesc": "MÁS COMODIDAD MÁS EXCLUSIVO",
    
    // Fleet
    "fleet.title": "NUESTRA FLOTA",
    "fleet.viewAll": "Ver Todo",
    "fleet.perDay": "/día",
    "fleet.bookNow": "Reservar",
    
    // Testimonials
    "testimonials.label": "TESTIMONIOS",
    "testimonials.title": "EXPERIENCIA DEL CLIENTE",
    
    // Rental Upload
    "rental.label": "DOCUMENTA TU ALQUILER",
    "rental.title": "FOTOS ANTES Y DESPUÉS",
    "rental.description": "Sube fotos del estado del vehículo para una experiencia sin problemas",
    
    // CTA
    "cta.title": "¿LISTO PARA LA CARRETERA?",
    "cta.description": "ÚNETE A ZONYX PARA TUS NECESIDADES DE ALQUILER DE COCHES ELÉCTRICOS.",
    "cta.button": "COMIENZA TU VIAJE",
    
    // Footer
    "footer.tagline": "EXPERIMENTA EL FUTURO VERDE",
    "footer.company": "EMPRESA",
    "footer.support": "SOPORTE",
    "footer.legal": "LEGAL",
    "footer.aboutUs": "Sobre Nosotros",
    "footer.careers": "Carreras",
    "footer.press": "Prensa",
    "footer.contact": "Contacto",
    "footer.faq": "Preguntas Frecuentes",
    "footer.helpCenter": "Centro de Ayuda",
    "footer.privacy": "Política de Privacidad",
    "footer.terms": "Términos de Servicio",
    "footer.cookies": "Política de Cookies",
  },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  const t = (key: string): string => {
    return translations[language][key as keyof typeof translations.en] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
