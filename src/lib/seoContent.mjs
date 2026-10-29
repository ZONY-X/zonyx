export const SITE_URL = 'https://www.gozonyx.com';
export const PHONE_HREF = 'tel:+13056155237';
export const PHONE_LABEL = '(305) 615-5237';
export const business = {
  '@type': ['Organization', 'AutoRental'], '@id': `${SITE_URL}/#business`,
  name: 'ZONYX', url: SITE_URL, telephone: '+1-305-615-5237', email: 'support@gozonyx.com',
  address: { '@type': 'PostalAddress', streetAddress: '601 Brickell Key Dr #11', addressLocality: 'Miami', addressRegion: 'FL', postalCode: '33131', addressCountry: 'US' },
  sameAs: ['https://www.instagram.com/gozonyx'], areaServed: ['Miami', 'South Florida'],
};
export const pages = {
  '/': { title: 'Tesla & Cybertruck Rental Miami | ZONYX Electric Vehicles', description: 'Rent a Tesla, Cybertruck or luxury electric vehicle in Miami with ZONYX. Explore the fleet, check your dates or call (305) 615-5237 for rental help.', h1: 'Tesla & Cybertruck rentals in Miami', intro: 'Explore electric vehicles for your Miami trip, from Tesla sedans to the Cybertruck and premium electric SUVs. Compare the fleet, select your rental dates and review availability before booking.' },
  '/fleet': { title: 'Luxury Electric Car & Tesla Rentals Miami | ZONYX Fleet', description: 'Compare Tesla, Cybertruck and luxury electric car rentals in Miami. View vehicle photos and daily rates, check availability or speak with ZONYX.', h1: 'Electric car rentals in Miami', intro: 'Compare Tesla, Porsche, BMW and other premium electric vehicles for Miami and South Florida. Each vehicle page includes its photos, daily base rate and a direct path to check your dates.' },
  '/tesla-rental-miami': { title: 'Tesla Rental Miami | Model 3, S, X & Cybertruck | ZONYX', description: 'Find a Tesla rental in Miami with ZONYX. Compare Model 3, Model S, Model X and Cybertruck options, view current daily rates and check your rental dates.', h1: 'Tesla rental in Miami', intro: 'Choose a Tesla for your Miami visit by comparing the vehicles actually listed in the ZONYX fleet. Model 3 and Model S offer sedan options, Model X adds an SUV option, and Cybertruck offers a distinct electric pickup experience. Availability depends on your dates.' },
  '/long-term-rentals': { title: 'Long-Term Tesla & Monthly Cybertruck Rental Miami | ZONYX', description: 'Planning a long-term Tesla or monthly Cybertruck rental in Miami? Speak with ZONYX about your dates, vehicle choice, availability and rental requirements.', h1: 'Long-term electric vehicle rentals in Miami', intro: 'Planning a longer stay in Miami? Contact ZONYX about a long-term Tesla rental or a monthly Cybertruck rental request. Tell us your dates, preferred model and pickup plans so our team can check the options. Monthly availability and any quote must be confirmed; no monthly rate or discount is guaranteed.' },
  '/contact': { title: 'Contact ZONYX | Call for Tesla & Cybertruck Rentals Miami', description: 'Call ZONYX at (305) 615-5237 for Tesla, Cybertruck and luxury electric vehicle rental inquiries in Miami, or contact support@gozonyx.com.', h1: 'Speak with ZONYX in Miami', intro: 'Need help choosing an electric vehicle or checking rental dates? Call (305) 615-5237 or email support@gozonyx.com. Our Miami address is 601 Brickell Key Dr #11, Miami, FL 33131.' },
  '/partners': { title: 'ZONYX Partner Program | Your Guests Drive. You Earn.', description: 'Explore the ZONYX referral program for Miami hospitality and concierge partners. Learn how approved partners can refer guests for electric vehicle rentals.', h1: 'Your Guests Drive. You Earn.', intro: 'A referral program for hotel concierges, vacation rental managers and hospitality businesses in Miami. See the application and eligibility details to learn how qualifying referrals work.' },
};
export const rentalQuestions = [
  ['How do I check availability?', 'Choose a vehicle, then enter your pickup and return dates and times. Review the available options and full rental total before payment. A daily base rate alone is not a reservation confirmation.'],
  ['Can I call before booking?', 'Yes. Call ZONYX at (305) 615-5237 with your preferred vehicle, dates and pickup plans. You can also browse and book through the online platform.'],
  ['What should I confirm before renting an EV?', 'Confirm the driver requirements, deposit and protection requirements, included mileage, pickup arrangements, cancellation terms and charging or return requirements for your trip. Review the rental agreement and ask our team about anything unclear.'],
  ['Can I request a longer rental?', 'Contact ZONYX with your full date range for a long-term Tesla or monthly Cybertruck inquiry. Availability, requirements and the applicable quote must be confirmed for the specific vehicle and trip.'],
];
export function vehicleCopy(v) {
  const name = `${v.year} ${v.brand} ${v.name}`;
  const cybertruck = /cybertruck/i.test(v.name);
  const intro = cybertruck
    ? `Rent the ${name} in Miami through ZONYX. Compare the electric pickup's photos and current daily base rate, then check the dates for your visit. Call our Miami team if you want help with pickup plans, rental requirements or a longer trip.`
    : `Explore the ${name}, a ${v.category.toLowerCase()}, for your Miami trip. Review this vehicle's photos and daily base rate, then enter your pickup and return dates to check availability. Speak with ZONYX to compare it with other electric vehicles in the fleet.`;
  return { title: `${cybertruck ? 'Tesla Cybertruck Rental Miami' : `${name} Rental in Miami`} | ZONYX`, description: `Rent the ${name} in Miami. View photos and the daily base rate, check your dates or call ZONYX at (305) 615-5237 for rental assistance.`, h1: `${name} rental in Miami`, intro };
}
export function pageSchema(path, title, crumbs = []) {
  const url = `${SITE_URL}${path}`;
  return { '@context': 'https://schema.org', '@graph': [business,
    { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: 'ZONYX', publisher: { '@id': business['@id'] } },
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: title, isPartOf: { '@id': `${SITE_URL}/#website` }, about: { '@id': business['@id'] } },
    ...(crumbs.length ? [{ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: crumbs.map(([name, route], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE_URL}${route}` })) }] : []),
  ] };
}
export function vehicleSchema(v, path, image) {
  const copy = vehicleCopy(v);
  const schema = pageSchema(path, copy.title, [['Home', '/'], ['Fleet', '/fleet'], [`${v.brand} ${v.name}`, path]]);
  schema['@graph'].push({ '@type': 'Car', '@id': `${SITE_URL}${path}#vehicle`, name: `${v.year} ${v.brand} ${v.name}`, description: copy.intro, brand: { '@type': 'Brand', name: v.brand }, model: v.name, vehicleModelDate: String(v.year), image: new URL(image, SITE_URL).href, category: v.category,
    offers: { '@type': 'Offer', url: `${SITE_URL}${path}`, businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut', seller: { '@id': business['@id'] }, priceSpecification: { '@type': 'UnitPriceSpecification', priceCurrency: 'USD', price: (v.base_daily_rate_cents / 100).toFixed(2), unitText: 'day', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'DAY' } } } });
  return schema;
}
