import { supabaseAdmin } from "@/lib/supabase/server";
import { getCanonicalCountry } from "@/lib/countries";
import { DELIVERY_FEE_USD, CHARGE_FIXE_LIVRAISON_USD } from "@/lib/marketSettings";

// Alimente le nouvel onglet "Tableau de bord" (courbes d'évolution + diagrammes par pays).
// Aucune des fonctions SQL kpi_*_marche_periode existantes ne donne de granularité JOURNALIÈRE
// (elles renvoient un seul total par pays sur toute la période) — ce fichier requête donc les
// tables brutes directement, avec exactement la même définition de "livré" que chaque fonction
// SQL correspondante (statut + colonne de date + décalage horaire WAT le cas échéant), vérifiée
// ligne par ligne dans les schémas Supabase avant d'écrire ce code :
//   - ClickMarket/Coliscod/Africod Congo : shipping_status in (processed,delivered,paid),
//     delivered_at + 1h (WAT, Angola/Gabon/Congo).
//   - Shipsen/ShipLead/MLShipAfrica : status in (processed,delivered,paid), shipping_date (déjà
//     une date sans heure — fix du 2026-08-04, voir shipsen_schema.sql).
//   - Ikatchiexpress : status = 'Livrée', updated_at (UTC, pas de décalage).
//
// Simplification assumée (disclosed sur le graphique, pas cachée) : la "marge" journalière ici
// = CA livré (USD) − dépense pub Meta Ads (USD) uniquement. Le calcul précis par pays (COGS,
// payout affiliés, frais de livraison réels Angola/Field Cash) reste sur /profitability — ce
// graphique est une vue d'ensemble rapide, pas un remplacement. Angola utilise ici le forfait
// 11$/commande standard (comme Coliscod seul), pas le coût réel Field Cash au jour le jour.

interface NetworkSpec {
  table: string;
  countryIdField?: string; // tables ClickMarket/Coliscod/Africod Congo (country_id + country_name dénormalisé)
  countryNameField?: string;
  countryField?: string; // tables Shipsen-family/Ikatchiexpress (code ISO brut)
  statusField: string;
  statusValues: string[];
  dateField: string;
  watOffsetHours: number;
}

const NETWORKS: NetworkSpec[] = [
  { table: "clickmarket_leads", countryIdField: "country_id", countryNameField: "country_name", statusField: "shipping_status", statusValues: ["processed", "delivered", "paid"], dateField: "delivered_at", watOffsetHours: 1 },
  { table: "coliscod_leads", countryIdField: "country_id", countryNameField: "country_name", statusField: "shipping_status", statusValues: ["processed", "delivered", "paid"], dateField: "delivered_at", watOffsetHours: 1 },
  { table: "africod_congo_leads", countryIdField: "country_id", countryNameField: "country_name", statusField: "shipping_status", statusValues: ["processed", "delivered", "paid"], dateField: "delivered_at", watOffsetHours: 1 },
  { table: "shipsen_orders", countryField: "country", statusField: "status", statusValues: ["processed", "delivered", "paid"], dateField: "shipping_date", watOffsetHours: 0 },
  { table: "shiplead_orders", countryField: "country", statusField: "status", statusValues: ["processed", "delivered", "paid"], dateField: "shipping_date", watOffsetHours: 0 },
  { table: "mlshipafrica_orders", countryField: "country", statusField: "status", statusValues: ["processed", "delivered", "paid"], dateField: "shipping_date", watOffsetHours: 0 },
  { table: "ikatchiexpress_orders", countryField: "country", statusField: "status", statusValues: ["Livrée"], dateField: "updated_at", watOffsetHours: 0 },
];

interface DeliveredRow {
  country: string; // nom canonique déjà résolu
  day: string; // AAAA-MM-JJ, déjà ajusté (WAT le cas échéant)
  totalPrice: number;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function bucketDay(rawDate: string, offsetHours: number): string {
  const d = new Date(rawDate);
  if (offsetHours) d.setUTCHours(d.getUTCHours() + offsetHours);
  return d.toISOString().slice(0, 10);
}

async function fetchNetworkDelivered(spec: NetworkSpec, paddedFrom: string, paddedTo: string, dateFrom: string, dateTo: string): Promise<DeliveredRow[]> {
  const selectCols = [spec.countryIdField, spec.countryNameField, spec.countryField, "total_price", spec.dateField].filter(Boolean).join(",");
  const { data, error } = await supabaseAdmin
    .from(spec.table)
    .select(selectCols)
    .in(spec.statusField, spec.statusValues)
    .not(spec.dateField, "is", null)
    .gte(spec.dateField, paddedFrom)
    .lte(spec.dateField, paddedTo);

  if (error || !data) return [];

  const rows: DeliveredRow[] = [];
  for (const row of data as unknown as Record<string, unknown>[]) {
    const day = bucketDay(String(row[spec.dateField]), spec.watOffsetHours);
    if (day < dateFrom || day > dateTo) continue;

    const country = spec.countryNameField
      ? String(row[spec.countryNameField] ?? "")
      : getCanonicalCountry(String(row[spec.countryField ?? ""] ?? ""))?.name ?? null;
    if (!country) continue;

    rows.push({ country, day, totalPrice: Number(row.total_price ?? 0) });
  }
  return rows;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  if (!dateFrom || !dateTo) return Response.json({ error: "dateFrom/dateTo requis" }, { status: 400 });

  // Marge d'un jour de chaque côté pour ne rater aucune ligne à cause du décalage WAT (+1h) ou
  // d'un fuseau horaire de stockage — le filtrage précis se fait ensuite en JS (bucketDay).
  const paddedFrom = addDaysIso(dateFrom, -1);
  const paddedTo = addDaysIso(dateTo, 1);

  const [marketSettingsRes, metaAdsRes, ...networkResults] = await Promise.all([
    supabaseAdmin.from("market_settings").select("pays,fx_to_usd"),
    supabaseAdmin.from("meta_ads_by_country").select("date,spend").gte("date", dateFrom).lte("date", dateTo),
    ...NETWORKS.map((spec) => fetchNetworkDelivered(spec, paddedFrom, paddedTo, dateFrom, dateTo)),
  ]);

  const fxByPays = new Map<string, number>((marketSettingsRes.data ?? []).map((s) => [s.pays as string, s.fx_to_usd as number]));

  // Frais de livraison total déduit du CA — (11$ forfait + 2$ charge fixe), même formule que
  // deliveryFeeLocal() (lib/marketSettings.ts), source unique de vérité, jamais recodée en dur ici.
  const TOTAL_DELIVERY_FEE_USD = DELIVERY_FEE_USD + CHARGE_FIXE_LIVRAISON_USD;

  const dailyByDate = new Map<string, { caLivreUsd: number; livres: number }>();
  const byCountry = new Map<string, { caLivreUsd: number; livres: number }>();

  for (const rows of networkResults) {
    for (const r of rows) {
      const fx = fxByPays.get(r.country);
      if (fx == null) continue; // pays hors market_settings — pas de taux fiable, exclu (comme ailleurs dans le dashboard)
      const caUsd = r.totalPrice / fx - TOTAL_DELIVERY_FEE_USD;

      const d = dailyByDate.get(r.day) ?? { caLivreUsd: 0, livres: 0 };
      d.caLivreUsd += caUsd;
      d.livres += 1;
      dailyByDate.set(r.day, d);

      const c = byCountry.get(r.country) ?? { caLivreUsd: 0, livres: 0 };
      c.caLivreUsd += caUsd;
      c.livres += 1;
      byCountry.set(r.country, c);
    }
  }

  const adSpendByDate = new Map<string, number>();
  for (const row of metaAdsRes.data ?? []) {
    const date = row.date as string;
    adSpendByDate.set(date, (adSpendByDate.get(date) ?? 0) + (Number(row.spend) || 0));
  }

  const allDates: string[] = [];
  for (let d = dateFrom; d <= dateTo; d = addDaysIso(d, 1)) allDates.push(d);

  const daily = allDates.map((date) => {
    const d = dailyByDate.get(date) ?? { caLivreUsd: 0, livres: 0 };
    const adSpendUsd = adSpendByDate.get(date) ?? 0;
    return {
      date,
      caLivreUsd: Math.round(d.caLivreUsd * 100) / 100,
      livres: d.livres,
      margeSimplifieeUsd: Math.round((d.caLivreUsd - adSpendUsd) * 100) / 100,
    };
  });

  const countries = [...byCountry.entries()]
    .map(([country, v]) => ({ country, caLivreUsd: Math.round(v.caLivreUsd * 100) / 100, livres: v.livres }))
    .sort((a, b) => b.caLivreUsd - a.caLivreUsd);

  return Response.json({ daily, byCountry: countries });
}
