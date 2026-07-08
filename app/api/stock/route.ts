// Proxy CRM Voralis GET /api/v1/products/stock (2026-07-08) — le stock est désormais géré par ce
// CRM, plus par Sheet ni par les CRM logistiques. Même mécanisme que app/api/networks/route.ts :
// URL absolue + Bearer REPORTING_API_KEY, réponse renvoyée telle quelle.
export async function GET() {
  const res = await fetch("https://www.voralisnatural.com/api/v1/products/stock", {
    headers: { Authorization: `Bearer ${process.env.REPORTING_API_KEY}` },
    cache: "no-store",
  });
  const data = await res.json();
  return Response.json(data);
}