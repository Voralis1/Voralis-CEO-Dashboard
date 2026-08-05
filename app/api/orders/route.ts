// Proxy vers /api/v1/reports/orders (CRM Voralis, ajouté 2026-08-04) — même clé que
// /api/networks (REPORTING_API_KEY), même traduction dateFrom/dateTo -> from/to.
// Pagine côté serveur (l'API source limite à 1000 lignes/appel) pour renvoyer la liste complète
// d'un coup — évite de reproduire la boucle de pagination dans chaque appelant côté client.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // garde-fou (50 000 commandes) — largement au-dessus du volume actuel

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const status = searchParams.get("status");

  const baseUrl = new URL("https://www.voralisnatural.com/api/v1/reports/orders");
  if (dateFrom) baseUrl.searchParams.set("from", dateFrom);
  if (dateTo) baseUrl.searchParams.set("to", dateTo);
  if (status) baseUrl.searchParams.set("status", status);
  baseUrl.searchParams.set("limit", String(PAGE_SIZE));

  const orders: unknown[] = [];
  let total: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set("offset", String(page * PAGE_SIZE));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.REPORTING_API_KEY}` },
      cache: "no-store",
    });

    // Le CRM Voralis peut répondre par une page d'erreur HTML (timeout, passerelle 502/504,
    // blocage Cloudflare) plutôt que du JSON — .json() planterait alors avec une exception
    // opaque ("Unexpected token <"), remontée telle quelle au navigateur. On lit le texte
    // d'abord pour renvoyer une erreur JSON propre et diagnosticable dans tous les cas.
    const text = await res.text();
    let data: { success?: boolean; message?: string; orders?: unknown[]; total?: number };
    try {
      data = JSON.parse(text);
    } catch {
      return Response.json(
        { success: false, message: `CRM Voralis a répondu avec un contenu non-JSON (HTTP ${res.status}) : ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }
    if (!data.success) return Response.json(data, { status: res.status });

    const batch = (data.orders ?? []) as unknown[];
    orders.push(...batch);
    total = data.total ?? total;

    if (batch.length < PAGE_SIZE || (total != null && orders.length >= total)) break;
  }

  return Response.json({ success: true, total: total ?? orders.length, orders });
}
