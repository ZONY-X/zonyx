import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getVehicleCanonicalPath, getVehicleSlug } from "../src/lib/vehicleSlug.mjs";

const siteUrl = "https://www.gozonyx.com";
const rootDir = process.cwd();
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const loadEnvironment = async () => {
  let contents = "";
  try { contents = await readFile(join(rootDir, ".env"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const line of contents.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (match) process.env[match[1]] = match[2] ?? match[3] ?? match[4];
  }
};

const fetchVehicles = async () => {
  await loadEnvironment();
  const baseUrl = process.env.VITE_SUPABASE_URL;
  const apiKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !apiKey) throw new Error("Missing public Supabase configuration.");
  const url = new URL("/rest/v1/vehicles", baseUrl);
  url.searchParams.set("select", "id,vehicle_identifier,year,brand,name,category,description,image_url,images,base_daily_rate_cents,is_active,availability_status");
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("availability_status", "eq.active");
  url.searchParams.set("order", "vehicle_identifier.asc");
  const response = await fetch(url, { headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`Unable to fetch public vehicles: ${response.status}`);
  return response.json();
};

const vehiclePage = (vehicle, slug, assets) => {
  const vehicleName = `${vehicle.year} ${vehicle.brand} ${vehicle.name}`;
  const title = `${vehicleName} Rental in Miami | ZONYX`;
  const description = `Rent the ${vehicleName} in Miami with ZONYX. View rental pricing, vehicle details and availability.`;
  const canonical = `${siteUrl}/vehicle/${slug}`;
  const image = vehicle.image_url || vehicle.images?.[0] || `${siteUrl}/placeholder.svg`;
  const schema = JSON.stringify({ "@context": "https://schema.org", "@type": "Car", name: vehicleName, brand: { "@type": "Brand", name: vehicle.brand }, image, category: vehicle.category, offers: { "@type": "Offer", businessFunction: "https://schema.org/LeaseOut", priceSpecification: { "@type": "UnitPriceSpecification", priceCurrency: "USD", price: (vehicle.base_daily_rate_cents / 100).toFixed(2), referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" } }, url: canonical } }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}" /><link rel="canonical" href="${canonical}" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:url" content="${canonical}" /><meta property="og:type" content="website" /><meta property="og:image" content="${escapeHtml(image)}" /><script type="application/ld+json">${schema}</script>${assets}</head><body><div id="root"><main><article><h1>${escapeHtml(vehicleName)} Rental in Miami</h1><p>${escapeHtml(description)}</p><img src="${escapeHtml(image)}" alt="${escapeHtml(`${vehicleName} rental in Miami`)}" /><p>Daily rental rate: $${(vehicle.base_daily_rate_cents / 100).toFixed(2)}</p></article></main></div></body></html>`;
};

const main = async () => {
  const vehicles = await fetchVehicles();
  const distIndex = await readFile(join(rootDir, "dist", "index.html"), "utf8");
  const assets = distIndex.match(/<link[^>]+href="\/assets\/[^"]+"[^>]*>|<script[^>]+src="\/assets\/[^"]+"[^>]*><\/script>/g)?.join("\n") ?? "";
  const urls = [`${siteUrl}/`, `${siteUrl}/fleet`, `${siteUrl}/contact`];
  for (const vehicle of vehicles) {
    const slug = getVehicleSlug(vehicle, vehicles);
    urls.push(`${siteUrl}${getVehicleCanonicalPath(vehicle, vehicles)}`);
    const directory = join(rootDir, "dist", "vehicle", slug);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), vehiclePage(vehicle, slug, assets));
  }
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}\n</urlset>\n`;
  await writeFile(join(rootDir, "public", "sitemap.xml"), sitemap);
  await writeFile(join(rootDir, "dist", "sitemap.xml"), sitemap);
  console.log(`Generated ${vehicles.length} canonical vehicle pages and sitemap entries.`);
};

void main();
