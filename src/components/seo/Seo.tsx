import { useEffect } from "react";

const SITE_URL = "https://www.gozonyx.com";

type SeoProps = {
  title: string;
  description: string;
  path: string;
  image?: string;
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
};

const setMetaContent = (selector: string, attribute: "name" | "property", value: string) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, selector.match(/="([^"]+)"/)?.[1] ?? "");
    document.head.appendChild(element);
  }
  element.content = value;
};

export const businessStructuredData = {
  "@context": "https://schema.org",
  "@type": "AutoRental",
  name: "ZONYX",
  url: SITE_URL,
  email: "support@gozonyx.com",
  telephone: "+1-305-615-5237",
  address: {
    "@type": "PostalAddress",
    streetAddress: "601 Brickell Key Dr #11",
    addressLocality: "Miami",
    addressRegion: "FL",
    postalCode: "33131",
    addressCountry: "US",
  },
  areaServed: ["Miami", "South Florida"],
};

export function Seo({ title, description, path, image, structuredData }: SeoProps) {
  useEffect(() => {
    const canonicalUrl = `${SITE_URL}${path}`;
    document.title = title;

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    setMetaContent('meta[name="description"]', "name", description);
    setMetaContent('meta[property="og:title"]', "property", title);
    setMetaContent('meta[property="og:description"]', "property", description);
    setMetaContent('meta[property="og:url"]', "property", canonicalUrl);
    if (image) setMetaContent('meta[property="og:image"]', "property", image);

    const existingScript = document.getElementById("zonyx-structured-data");
    if (existingScript) existingScript.remove();
    if (structuredData) {
      const script = document.createElement("script");
      script.id = "zonyx-structured-data";
      script.type = "application/ld+json";
      script.text = JSON.stringify(structuredData);
      document.head.appendChild(script);
    }
  }, [description, image, path, structuredData, title]);

  return null;
}