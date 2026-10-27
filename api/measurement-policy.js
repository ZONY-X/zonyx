// Only a country-level eligibility decision is returned. No identifiers,
// cookies, payment data, or precise location are read or persisted here.
// Vercel supplies the geolocation header; missing/unknown regions fail closed.
export default function handler(request, response) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Vary', 'X-Vercel-IP-Country, Sec-GPC, DNT');
  if (request.method !== 'GET') return response.status(405).json({ analyticsAllowed: false });
  const headers = request.headers;
  const analyticsAllowed = headers['x-vercel-ip-country'] === 'US'
    && headers['sec-gpc'] !== '1' && headers.dnt !== '1';
  return response.status(200).json({ analyticsAllowed });
}
