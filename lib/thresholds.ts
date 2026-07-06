import { supabaseAdmin } from "@/lib/supabase/server";
import { getCanonicalCountry } from "@/lib/countries";
import { computeBaseMargin, computeL } from "@/lib/margin";
import type { MarketSettings } from "@/lib/marketSettings";

// Module "Seuils de rentabilité & plafonds d'acquisition" — moteur 100% serveur (jamais appelé
// depuis le navigateur) car il manipule COGS/marge plancher T, confidentiels CEO. Réutilise
// lib/margin.ts telle quelle (même M, même L, même gestion NULL que /profitability) — aucune
// formule réimplémentée. Le coût call center n'entre plus dans M : il est inclus dans les 11
// USD/commande de frais de livraison fixe (cf. lib/margin.ts).
//
// Astuce de calcul : computeBaseMargin(livres=1, caLivre=AOV, settings) donne directement les
// coûts PAR UNITÉ (COGS/retours par livrée) puisque la fonction est déjà linéaire en "livres"
// — pas besoin d'une variante "par unité" séparée.
//
// Ce fichier duplique volontairement l'agrégation par pays des 4 réseaux COD/Meta Ads/CRM déjà
// écrite dans lib/providerKpi.ts et lib/profitability.ts, mais via supabaseAdmin (service_role)
// au lieu du client navigateur : ces derniers appellent des RPC Supabase accordées au rôle
// "authenticated" (via la session utilisateur, absente dans un contexte serveur pur) ou des
// routes internes en URL relative (invalides côté serveur). La LOGIQUE d'agrégation est
// identique, seul le transport diffère.

export interface ThresholdCeoDetail {
  M_local: number | null;
  M_usd: number | null;
  T_local: number;
  T_usd: number;
  cogsPerUnitLocal: number | null;
  retoursPerUnitLocal: number | null;
  L: number | null;
}

export type TrafficColor = "green" | "orange" | "red";

export interface ThresholdRow {
  pays: string;
  currency: string;
  missingFields: string[];
  fxMissing: boolean;
  aovUsed: number | null;
  aovSource: "observed" | "override" | null;
  periodeReel: { dateFrom: string; dateTo: string };

  // Présent uniquement pour le rôle CEO — l'API route retire cette clé entièrement pour "team".
  ceoDetail?: ThresholdCeoDetail;

  // Plafonds actionnables — visibles par tous les rôles.
  cplMaxUsd: number | null;
  cplBreakEvenUsd: number | null;
  cplMaxLocal: number | null;
  payoutMaxUsd: number | null;
  payoutBreakEvenUsd: number | null;

  // Réel observé, pour comparaison — visible par tous les rôles (ce n'est pas la marge).
  cplReelUsd: number | null;
  payoutReelUsd: number | null;

  cplColor: TrafficColor | null;
  payoutColor: TrafficColor | null;
}

function colorFor(reel: number | null, max: number | null, breakEven: number | null): TrafficColor | null {
  if (reel == null || max == null || breakEven == null) return null;
  if (reel <= max) return "green";
  if (reel <= breakEven) return "orange";
  return "red";
}

export function computeThresholdRow(
  settings: MarketSettings,
  aovObserved: number | null,
  cplReelUsd: number | null,
  payoutReelUsd: number | null,
  periodeReel: { dateFrom: string; dateTo: string }
): ThresholdRow {
  const missingFields: string[] = [];

  const aovIsOverride = settings.aov_override != null;
  const aovUsed = aovIsOverride ? settings.aov_override : aovObserved;
  const aovSource: ThresholdRow["aovSource"] = aovIsOverride ? "override" : aovObserved != null ? "observed" : null;
  if (aovUsed == null) {
    missingFields.push("AOV encaissé (aucune commande livrée sur la période sélectionnée, et aucune surcharge CEO saisie)");
  }

  let cogsPerUnitLocal: number | null = null;
  let retoursPerUnitLocal: number | null = null;
  let revenuNetLivraisonUnit: number | null = null;

  if (aovUsed != null) {
    const base = computeBaseMargin(1, aovUsed, settings);
    cogsPerUnitLocal = base.cogsTotal;
    retoursPerUnitLocal = base.coutRetoursTotal;
    revenuNetLivraisonUnit = base.revenuNetLivraison;
    missingFields.push(...base.missingFields);
  }

  const M_local =
    revenuNetLivraisonUnit != null && cogsPerUnitLocal != null && retoursPerUnitLocal != null
      ? revenuNetLivraisonUnit - cogsPerUnitLocal - retoursPerUnitLocal
      : null;

  // Base USD choisie pour comparer les marchés entre eux et rester cohérent avec le payout
  // affilié (toujours en USD côté CRM) — voir doc du module. Reconverti en local pour affichage.
  const M_usd = M_local != null ? M_local / settings.fx_to_usd : null;
  const T_local = settings.marge_plancher_t;
  const T_usd = T_local / settings.fx_to_usd;

  const L = computeL(settings.conf_pct, settings.dr_pct);
  if (L == null) {
    missingFields.push("taux de confirmation/taux de livraison (nécessaires pour calculer le plafond CPL)");
  }

  const cplMaxUsd = M_usd != null && L != null ? (M_usd - T_usd) / L : null;
  const cplBreakEvenUsd = M_usd != null && L != null ? M_usd / L : null;
  const cplMaxLocal = cplMaxUsd != null ? cplMaxUsd * settings.fx_to_usd : null;

  const payoutMaxUsd = M_usd != null && settings.dr_pct != null ? (settings.dr_pct / 100) * (M_usd - T_usd) : null;
  const payoutBreakEvenUsd = M_usd != null && settings.dr_pct != null ? (settings.dr_pct / 100) * M_usd : null;

  return {
    pays: settings.pays,
    currency: settings.devise_locale,
    missingFields,
    fxMissing: false, // fx_to_usd est NOT NULL en base pour les 7 marchés actuels
    aovUsed,
    aovSource,
    periodeReel,
    ceoDetail: { M_local, M_usd, T_local, T_usd, cogsPerUnitLocal, retoursPerUnitLocal, L },
    cplMaxUsd,
    cplBreakEvenUsd,
    cplMaxLocal,
    payoutMaxUsd,
    payoutBreakEvenUsd,
    cplReelUsd,
    payoutReelUsd,
    cplColor: colorFor(cplReelUsd, cplMaxUsd, cplBreakEvenUsd),
    payoutColor: colorFor(payoutReelUsd, payoutMaxUsd, payoutBreakEvenUsd),
  };
}

// ─── Agrégats côté serveur (supabaseAdmin) ─────────────────────────────────────────────────

const COD_RPCS = [
  { fn: "kpi_clickmarket_marche_periode", countryField: "country_name" },
  { fn: "kpi_coliscod_marche_periode", countryField: "country_name" },
  { fn: "kpi_africod_congo_marche_periode", countryField: "country_name" },
] as const;

async function fetchCodAggregatesByCountry(dateFrom: string, dateTo: string): Promise<Map<string, { livres: number; caLivre: number }>> {
  const aggregated = new Map<string, { livres: number; caLivre: number }>();

  const results = await Promise.all(
    COD_RPCS.map((r) => supabaseAdmin.rpc(r.fn, { date_from: dateFrom, date_to: dateTo }))
  );
  const shipsenResult = await supabaseAdmin.rpc("kpi_shipsen_marche_periode", { date_from: dateFrom, date_to: dateTo });

  function addRow(rawCountry: string, livres: number, caLivre: number) {
    const canonical = getCanonicalCountry(rawCountry);
    if (!canonical) return;
    const entry = aggregated.get(canonical.name) ?? { livres: 0, caLivre: 0 };
    entry.livres += livres;
    entry.caLivre += caLivre;
    aggregated.set(canonical.name, entry);
  }

  for (let i = 0; i < COD_RPCS.length; i++) {
    const rows = (results[i].data ?? []) as { country_name: string; livres: number; ca_livre: number }[];
    for (const row of rows) addRow(row.country_name, row.livres, row.ca_livre);
  }

  const shipsenRows = (shipsenResult.data ?? []) as { country: string; livres: number; revenue_delivered: number }[];
  for (const row of shipsenRows) addRow(row.country, row.livres, row.revenue_delivered);

  return aggregated;
}

async function fetchAdMetricsByCountry(): Promise<Map<string, { spend: number; leads: number }>> {
  // Pas de filtrage par date possible ici : meta_ads_by_country est un snapshot cumulatif
  // (colonne `date` jamais renseignée, cf. lib/supabase/queries.ts) — le "CPL réel" du module
  // Seuils reste donc cumulé tout historique, pas borné à la période sélectionnée. Signalé
  // explicitement dans l'UI plutôt que de prétendre à un filtrage qui n'existe pas.
  const { data } = await supabaseAdmin.from("meta_ads_by_country").select("country, spend, leads");
  const byCountry = new Map<string, { spend: number; leads: number }>();
  for (const row of (data ?? []) as { country: string; spend: number; leads: number }[]) {
    const canonical = getCanonicalCountry(row.country);
    if (!canonical) continue;
    const entry = byCountry.get(canonical.name) ?? { spend: 0, leads: 0 };
    entry.spend += row.spend ?? 0;
    entry.leads += row.leads ?? 0;
    byCountry.set(canonical.name, entry);
  }
  return byCountry;
}

async function fetchAffiliatePayoutByCountry(dateFrom: string, dateTo: string): Promise<Map<string, { totalPayoutUsd: number; confirmedOrders: number }>> {
  const byCountry = new Map<string, { totalPayoutUsd: number; confirmedOrders: number }>();
  try {
    const url = new URL("https://www.voralisnatural.com/api/v1/reports/networks");
    url.searchParams.set("from", dateFrom);
    url.searchParams.set("to", dateTo);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.REPORTING_API_KEY}` }, cache: "no-store" });
    const json = await res.json();
    if (!json.success) return byCountry;

    for (const row of (json.by_country ?? []) as { country: string; stats: { total_payout: number; confirmed_orders: number } }[]) {
      const canonical = getCanonicalCountry(row.country);
      if (!canonical) continue;
      const entry = byCountry.get(canonical.name) ?? { totalPayoutUsd: 0, confirmedOrders: 0 };
      entry.totalPayoutUsd += row.stats.total_payout ?? 0;
      entry.confirmedOrders += row.stats.confirmed_orders ?? 0;
      byCountry.set(canonical.name, entry);
    }
  } catch {
    // CRM injoignable — le module continue avec payoutReel=null pour tous les marchés
    // (pas de couleur affilié, cf. règle "pas de pastille fausse si le réel est indisponible").
  }
  return byCountry;
}

export async function computeAllThresholds(dateFrom: string, dateTo: string): Promise<ThresholdRow[]> {
  const [marketSettingsRes, codAggregates, adMetrics, affiliatePayouts] = await Promise.all([
    supabaseAdmin.from("market_settings").select("*").order("pays"),
    fetchCodAggregatesByCountry(dateFrom, dateTo),
    fetchAdMetricsByCountry(),
    fetchAffiliatePayoutByCountry(dateFrom, dateTo),
  ]);

  const marketSettingsList = (marketSettingsRes.data ?? []) as MarketSettings[];
  const periodeReel = { dateFrom, dateTo };

  return marketSettingsList.map((settings) => {
    const cod = codAggregates.get(settings.pays);
    const aovObserved = cod && cod.livres > 0 ? cod.caLivre / cod.livres : null;

    const ads = adMetrics.get(settings.pays);
    const cplReelUsd = ads && ads.leads > 0 ? ads.spend / ads.leads : null;

    const aff = affiliatePayouts.get(settings.pays);
    const payoutReelUsd = aff && aff.confirmedOrders > 0 ? aff.totalPayoutUsd / aff.confirmedOrders : null;

    return computeThresholdRow(settings, aovObserved, cplReelUsd, payoutReelUsd, periodeReel);
  });
}

// Retire tout ce qui est réservé au CEO — utilisé par l'API route pour le rôle "team". Ne
// jamais envoyer ceoDetail (M, T, COGS, coût call center, décomposition) à un rôle non-CEO,
// même masqué côté front : la donnée ne doit tout simplement pas quitter le serveur.
export function stripCeoDetail(rows: ThresholdRow[]): Omit<ThresholdRow, "ceoDetail">[] {
  return rows.map((row) => {
    const rest: ThresholdRow = { ...row };
    delete rest.ceoDetail;
    return rest;
  });
}
