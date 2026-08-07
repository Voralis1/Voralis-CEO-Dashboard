import { supabaseAdmin } from "@/lib/supabase/server";
import { getCanonicalCountry } from "@/lib/countries";
import { getCurrentUserRole } from "@/lib/auth/role";
import { DELIVERY_FEE_USD, CHARGE_FIXE_LIVRAISON_USD } from "@/lib/marketSettings";
import { COGS_PRODUCTION_UNIT_USD, COGS_SHIPPING_UNIT_USD } from "@/lib/margin";

// Alimente l'onglet "Tableau de bord" (courbes d'évolution CA livré / marge nette réelle /
// commandes livrées + diagrammes par pays). Aucune des fonctions SQL kpi_*_marche_periode
// existantes ne donne de granularité JOURNALIÈRE (elles renvoient un seul total par pays sur
// toute la période) — ce fichier requête donc les tables brutes directement, avec exactement la
// même définition de "livré" que chaque fonction SQL correspondante (statut + colonne de date +
// décalage horaire WAT le cas échéant), vérifiée ligne par ligne dans les schémas Supabase avant
// d'écrire ce code :
//   - ClickMarket/Coliscod/Africod Congo : shipping_status in (processed,delivered,paid),
//     delivered_at + 1h (WAT, Angola/Gabon/Congo).
//   - Shipsen/ShipLead/MLShipAfrica : status in (processed,delivered,paid), shipping_date (déjà
//     une date sans heure — fix du 2026-08-04, voir shipsen_schema.sql).
//   - Ikatchiexpress : status = 'Livrée', updated_at (UTC, pas de décalage).
//
// Marge nette réelle JOURNALIÈRE (2026-08-07) : contrairement à /profitability (qui reste
// toujours en devise locale, par pays), cette courbe est volontairement calculée directement en
// USD, tous pays confondus, comme le reste de cet onglet (vue d'ensemble rapide) — voir §3.5 du
// SOP sur ce choix. Chaque terme est déjà natif en USD (ad spend Meta Ads, payout CRM Voralis) ou
// une constante USD (COGS), donc aucune conversion fx_to_usd par pays n'est nécessaire ici,
// contrairement à /profitability : marge(jour) = CA livré(jour) − ad spend(jour) − payout
// affilié(jour) − COGS(jour). Angola utilise ici le forfait de livraison standard (comme les 6
// autres marchés), pas le coût réel Field Cash — même simplification déjà assumée pour la courbe
// de CA livré avant ce changement.
//
// Réservé au rôle CEO (getCurrentUserRole) : la marge est une donnée confidentielle, jamais
// exposée au rôle "team" même reformulée — cf. Règle du dashboard "jamais exposer la marge à
// l'équipe". Contrairement à /profitability (qui expose une erreur 403 en cascade au rôle team
// via fetchMarketSettings), ce endpoint dégrade proprement : `margeReelleUsd` vaut `null` pour
// tout utilisateur non-CEO, jamais une exception qui casserait le reste de la page.

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

// Mêmes 6 tables que fetchQuantitySentByCountryServer (lib/copilot/snapshot.ts) — dupliqué ici
// avec un bucket par jour (shipment_date) plutôt qu'un total période, jamais recodé pour le
// montant unitaire (COGS_PRODUCTION_UNIT_USD/COGS_SHIPPING_UNIT_USD importés de lib/margin.ts).
const SHIPMENT_TABLES = [
  "clickmarket_shipments",
  "coliscod_shipments",
  "africod_congo_shipments",
  "shipsen_expeditions",
  "shiplead_shipments",
  "mlshipafrica_shipments",
];

const CRM_NETWORKS_URL = "https://www.voralisnatural.com/api/v1/reports/networks";

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

// Dépense Meta Ads par jour, déjà en USD dans la source (meta_ads_by_country) — sommée tous pays
// confondus, aucune conversion fx nécessaire.
async function fetchDailyAdSpendUsd(dateFrom: string, dateTo: string): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin.from("meta_ads_by_country").select("date, spend").gte("date", dateFrom).lte("date", dateTo);
  const byDay = new Map<string, number>();
  for (const row of (data ?? []) as { date: string; spend: number | null }[]) {
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + (row.spend ?? 0));
  }
  return byDay;
}

// Quantité expédiée par jour (shipment_date), tous pays confondus — base du COGS journalier
// (quantité × 15$/unité, cf. lib/margin.ts). Comme /profitability, c'est la date d'EXPÉDITION,
// pas de vente : un jour avec un gros envoi fournisseur peut ponctuellement peser plus que les
// livraisons réelles de ce même jour — même approximation déjà acceptée au niveau période.
async function fetchDailyQuantitySent(dateFrom: string, dateTo: string): Promise<Map<string, number>> {
  const results = await Promise.all(
    SHIPMENT_TABLES.map((table) =>
      supabaseAdmin.from(table).select("shipment_date, quantity_sent").gte("shipment_date", dateFrom).lte("shipment_date", dateTo)
    )
  );

  const byDay = new Map<string, number>();
  for (const res of results) {
    for (const row of (res.data ?? []) as { shipment_date: string | null; quantity_sent: number | null }[]) {
      if (!row.shipment_date) continue;
      const day = row.shipment_date.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + (row.quantity_sent ?? 0));
    }
  }
  return byDay;
}

// Payout affilié CRM Voralis, RÉELLEMENT journalier (pas une répartition estimée) : l'API
// /api/v1/reports/networks accepte from/to, donc un appel par jour (from=to=ce jour) renvoie le
// vrai total payout de CE jour précis, exactement comme fetchAffiliatePayoutUsdByCountry
// (lib/profitability.ts) le fait pour toute la période d'un coup. `null` = CRM injoignable pour
// ce jour précis (timeout, erreur réseau) — jamais traité comme 0, pour ne pas fausser la marge
// affichée : le point correspondant reste un trou dans la courbe plutôt qu'un chiffre inventé.
async function fetchDailyPayoutUsd(dateFrom: string, dateTo: string): Promise<Map<string, number | null>> {
  const days: string[] = [];
  for (let d = dateFrom; d <= dateTo; d = addDaysIso(d, 1)) days.push(d);

  const results = await Promise.all(
    days.map(async (day) => {
      try {
        const url = new URL(CRM_NETWORKS_URL);
        url.searchParams.set("from", day);
        url.searchParams.set("to", day);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${process.env.REPORTING_API_KEY}` },
          cache: "no-store",
        });
        const json = (await res.json()) as { success?: boolean; by_country?: { country: string; stats: { total_payout?: number } }[] };
        if (!json.success) return [day, null] as const;

        const payoutUsd = (json.by_country ?? []).reduce((sum, row) => {
          if (!getCanonicalCountry(row.country)) return sum; // pays non reconnu — exclu, cohérent avec le reste du dashboard
          return sum + (row.stats?.total_payout ?? 0);
        }, 0);
        return [day, payoutUsd] as const;
      } catch {
        return [day, null] as const;
      }
    })
  );

  return new Map(results);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  if (!dateFrom || !dateTo) return Response.json({ error: "dateFrom/dateTo requis" }, { status: 400 });

  const role = await getCurrentUserRole();

  // Marge d'un jour de chaque côté pour ne rater aucune ligne à cause du décalage WAT (+1h) ou
  // d'un fuseau horaire de stockage — le filtrage précis se fait ensuite en JS (bucketDay).
  const paddedFrom = addDaysIso(dateFrom, -1);
  const paddedTo = addDaysIso(dateTo, 1);

  const [marketSettingsRes, ...networkResults] = await Promise.all([
    supabaseAdmin.from("market_settings").select("pays,fx_to_usd"),
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

  const allDates: string[] = [];
  for (let d = dateFrom; d <= dateTo; d = addDaysIso(d, 1)) allDates.push(d);

  // Rôle "team" : jamais d'appel CRM/shipments pour la marge, jamais un chiffre calculé puis
  // masqué à l'affichage — la donnée n'est même pas produite (cohérent avec le reste du dashboard).
  const cogsUnitUsd = COGS_PRODUCTION_UNIT_USD + COGS_SHIPPING_UNIT_USD;
  const [adSpendByDay, cogsQtyByDay, payoutByDay] =
    role === "ceo"
      ? await Promise.all([fetchDailyAdSpendUsd(dateFrom, dateTo), fetchDailyQuantitySent(dateFrom, dateTo), fetchDailyPayoutUsd(dateFrom, dateTo)])
      : [new Map<string, number>(), new Map<string, number>(), new Map<string, number | null>()];

  const daily = allDates.map((date) => {
    const d = dailyByDate.get(date) ?? { caLivreUsd: 0, livres: 0 };

    let margeReelleUsd: number | null = null;
    if (role === "ceo") {
      const payoutUsd = payoutByDay.get(date);
      if (payoutUsd != null) {
        const adSpendUsd = adSpendByDay.get(date) ?? 0;
        const cogsUsd = (cogsQtyByDay.get(date) ?? 0) * cogsUnitUsd;
        margeReelleUsd = Math.round((d.caLivreUsd - adSpendUsd - payoutUsd - cogsUsd) * 100) / 100;
      }
    }

    return {
      date,
      caLivreUsd: Math.round(d.caLivreUsd * 100) / 100,
      livres: d.livres,
      margeReelleUsd,
    };
  });

  const countries = [...byCountry.entries()]
    .map(([country, v]) => ({ country, caLivreUsd: Math.round(v.caLivreUsd * 100) / 100, livres: v.livres }))
    .sort((a, b) => b.caLivreUsd - a.caLivreUsd);

  return Response.json({ daily, byCountry: countries, role });
}
