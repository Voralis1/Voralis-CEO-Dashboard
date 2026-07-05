export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  // Vérifié en direct sur l'API : ses vrais paramètres sont `from`/`to` (confirmé via le champ
  // `filters` renvoyé dans la réponse) — PAS `dateFrom`/`dateTo`. On garde notre propre
  // convention dateFrom/dateTo côté interne (cohérent avec le reste de l'app) et on traduit
  // uniquement à l'appel externe.
  const url = new URL("https://www.voralisnatural.com/api/v1/reports/networks");
  if (dateFrom) url.searchParams.set("from", dateFrom);
  if (dateTo) url.searchParams.set("to", dateTo);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.REPORTING_API_KEY}` },
    cache: "no-store",
  });
  const data = await res.json();
  return Response.json(data);
}
