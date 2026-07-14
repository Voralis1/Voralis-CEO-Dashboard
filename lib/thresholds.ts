import { supabaseAdmin } from "@/lib/supabase/server";
import { getCanonicalCountry } from "@/lib/countries";
import { computeBaseMargin, computeL, COGS_PRODUCTION_UNIT_USD, COGS_SHIPPING_UNIT_USD } from "@/lib/margin";
import { resolveFraisLivraisonUnitaire, combineLivresCaLivre, type FieldCashRecap } from "@/lib/fieldCash";
import { fetchFieldCashRecap as fetchFieldCashRecapServer } from "@/lib/fieldCashServer";
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

// Plafond de payout affilié (2026-07-14, décision CEO) : forfait fixe, plus calculé à partir de
// dr_pct×(M-T) — voir computeThresholdRow.
export const AFFILIATE_PAYOUT_MAX_USD = 9;

export interface ThresholdCeoDetail {
  M_local: number | null;
  M_usd: number | null;
  T_local: number;
  T_usd: number;
  cogsPerUnitLocal: number | null;
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
  periodeReel: { dateFrom: string; dateTo: string },
  fieldCashRecap: FieldCashRecap | null = null,
  // Angola (2026-07-14) : volume Coliscod sur la même période, pour pondérer son forfait
  // 11$/livraison avec le coût réel Field Cash dans resolveFraisLivraisonUnitaire — cohérent
  // avec le total combiné utilisé en Trésorerie/Rentabilité (voir combineLivresCaLivre). 0 pour
  // les 6 pays external_11usd (paramètre ignoré dans ce cas).
  networkLivres = 0,
  // Taux de confirmation/livraison RÉELS observés sur les réseaux logistiques de la période
  // (2026-07-14, demande CEO) — priment sur settings.conf_pct/dr_pct (saisie manuelle), qui ne
  // sert plus que de repli si le marché n'a aucune commande sur la période (ex. tout juste
  // lancé). confPctObserved = confirmes/totalLeads, drPctObserved = livres/confirmes — PAS
  // livres/totalLeads (le "Taux livraison" affiché sur les pages réseaux), qui mélangerait déjà
  // conf% et dr% dans une seule valeur et fausserait L = 1/(conf%×dr%).
  confPctObserved: number | null = null,
  drPctObserved: number | null = null
): ThresholdRow {
  const missingFields: string[] = [];

  const aovIsOverride = settings.aov_override != null;
  const aovUsed = aovIsOverride ? settings.aov_override : aovObserved;
  const aovSource: ThresholdRow["aovSource"] = aovIsOverride ? "override" : aovObserved != null ? "observed" : null;
  if (aovUsed == null) {
    missingFields.push("AOV encaissé (aucune commande livrée sur la période sélectionnée, et aucune surcharge CEO saisie)");
  }

  let cogsPerUnitLocal: number | null = null;
  let revenuNetLivraisonUnit: number | null = null;

  if (aovUsed != null) {
    // Astuce livres=1 : il faut un frais de livraison PAR UNITÉ, pas un total période — pour
    // l'Angola (internal_real_cost), c'est le coût interne moyen observé sur la période (cf.
    // lib/fieldCash.ts), faute d'un "coût de la prochaine commande" connu à l'avance.
    const { fraisLivraisonUnitaire, chargesExternesUnitaire } = resolveFraisLivraisonUnitaire(
      settings,
      fieldCashRecap,
      networkLivres
    );
    // COGS (2026-07-14, demande CEO) : taux forfaitaire par unité (production + livraison
    // fournisseur), même constantes que Trésorerie/Rentabilité — pas besoin de quantité
    // expédiée réelle ici, "1" commande simulée = "1" unité de produit.
    const cogsUnitaireLocal = (COGS_PRODUCTION_UNIT_USD + COGS_SHIPPING_UNIT_USD) * settings.fx_to_usd;
    const base = computeBaseMargin(aovUsed, settings, fraisLivraisonUnitaire, chargesExternesUnitaire, cogsUnitaireLocal);
    cogsPerUnitLocal = base.cogsTotal;
    revenuNetLivraisonUnit = base.revenuNetLivraison;
    missingFields.push(...base.missingFields);
  }

  const M_local =
    revenuNetLivraisonUnit != null && cogsPerUnitLocal != null ? revenuNetLivraisonUnit - cogsPerUnitLocal : null;

  // Base USD choisie pour comparer les marchés entre eux et rester cohérent avec le payout
  // affilié (toujours en USD côté CRM) — voir doc du module. Reconverti en local pour affichage.
  const M_usd = M_local != null ? M_local / settings.fx_to_usd : null;
  const T_local = settings.marge_plancher_t;
  const T_usd = T_local / settings.fx_to_usd;

  // Taux de confirmation/livraison RÉELS observés (2026-07-14, demande CEO) priment sur la
  // saisie manuelle market_settings.conf_pct/dr_pct — repli uniquement si le marché n'a aucune
  // commande sur la période (aucun L calculable sans donnée).
  const confPctUsed = confPctObserved ?? settings.conf_pct;
  const drPctUsed = drPctObserved ?? settings.dr_pct;
  const L = computeL(confPctUsed, drPctUsed);
  if (L == null) {
    missingFields.push("taux de confirmation/taux de livraison (nécessaires pour calculer le plafond CPL)");
  }

  const cplMaxUsd = M_usd != null && L != null ? (M_usd - T_usd) / L : null;
  const cplBreakEvenUsd = M_usd != null && L != null ? M_usd / L : null;
  const cplMaxLocal = cplMaxUsd != null ? cplMaxUsd * settings.fx_to_usd : null;

  // Payout affiliés (2026-07-14, demande CEO) : plafond forfaitaire de AFFILIATE_PAYOUT_MAX_USD
  // par commande confirmée (plus calculé via dr_pct×(M-T)). Le break-even est déduit par la même
  // proportion que cplBreakEvenUsd/cplMaxUsd (= M_usd/(M_usd-T_usd)), pour garder la même marge
  // de sécurité relative que le plafond CPL. Nécessite M_usd > T_usd (marge positive) sinon la
  // proportion n'a pas de sens (dénominateur nul/négatif).
  const payoutMaxUsd = M_usd != null ? AFFILIATE_PAYOUT_MAX_USD : null;
  const payoutBreakEvenUsd =
    M_usd != null && M_usd - T_usd > 0 ? AFFILIATE_PAYOUT_MAX_USD * (M_usd / (M_usd - T_usd)) : null;

  return {
    pays: settings.pays,
    currency: settings.devise_locale,
    missingFields,
    fxMissing: false, // fx_to_usd est NOT NULL en base pour les 7 marchés actuels
    aovUsed,
    aovSource,
    periodeReel,
    ceoDetail: { M_local, M_usd, T_local, T_usd, cogsPerUnitLocal, L },
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

interface CodAggregate {
  livres: number;
  caLivre: number;
  // totalLeads/confirmes (2026-07-14) : ajoutés pour calculer le taux de confirmation/livraison
  // RÉEL observé sur les réseaux logistiques de la période (voir computeAllThresholds ci-dessous)
  // — remplace la saisie manuelle conf_pct/dr_pct de market_settings comme source PRIMAIRE
  // (demande CEO : "sont normalement disponibles grâce aux pages des réseaux logistiques").
  totalLeads: number;
  confirmes: number;
}

async function fetchCodAggregatesByCountry(dateFrom: string, dateTo: string): Promise<Map<string, CodAggregate>> {
  const aggregated = new Map<string, CodAggregate>();

  const results = await Promise.all(
    COD_RPCS.map((r) => supabaseAdmin.rpc(r.fn, { date_from: dateFrom, date_to: dateTo }))
  );
  const shipsenResult = await supabaseAdmin.rpc("kpi_shipsen_marche_periode", { date_from: dateFrom, date_to: dateTo });

  function addRow(rawCountry: string, livres: number, caLivre: number, totalLeads: number, confirmes: number) {
    const canonical = getCanonicalCountry(rawCountry);
    if (!canonical) return;
    const entry = aggregated.get(canonical.name) ?? { livres: 0, caLivre: 0, totalLeads: 0, confirmes: 0 };
    entry.livres += livres;
    entry.caLivre += caLivre;
    entry.totalLeads += totalLeads;
    entry.confirmes += confirmes;
    aggregated.set(canonical.name, entry);
  }

  for (let i = 0; i < COD_RPCS.length; i++) {
    const rows = (results[i].data ?? []) as { country_name: string; livres: number; ca_livre: number; total_leads: number; confirmes: number }[];
    for (const row of rows) addRow(row.country_name, row.livres, row.ca_livre, row.total_leads, row.confirmes);
  }

  const shipsenRows = (shipsenResult.data ?? []) as { country: string; livres: number; revenue_delivered: number; total_orders: number; confirmed_orders: number }[];
  for (const row of shipsenRows) addRow(row.country, row.livres, row.revenue_delivered, row.total_orders, row.confirmed_orders);

  return aggregated;
}

async function fetchAdMetricsByCountry(dateFrom: string, dateTo: string): Promise<Map<string, { spend: number; leads: number }>> {
  // meta_ads_by_country a désormais une ligne par (pays, canal, jour) avec une vraie colonne
  // `date` (confirmé le 2026-07-06) — le "CPL réel" du module Seuils est donc borné à la
  // période sélectionnée, plus cumulé tout historique.
  const { data } = await supabaseAdmin
    .from("meta_ads_by_country")
    .select("country, spend, leads")
    .gte("date", dateFrom)
    .lte("date", dateTo);
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
    fetchAdMetricsByCountry(dateFrom, dateTo),
    fetchAffiliatePayoutByCountry(dateFrom, dateTo),
  ]);

  const marketSettingsList = (marketSettingsRes.data ?? []) as MarketSettings[];
  const periodeReel = { dateFrom, dateTo };

  const internalCostCountries = marketSettingsList.filter((s) => s.delivery_model === "internal_real_cost");
  const fieldCashRecaps = await Promise.all(
    internalCostCountries.map((s) => fetchFieldCashRecapServer(s.pays, dateFrom, dateTo))
  );
  const fieldCashByPays = new Map<string, FieldCashRecap>(internalCostCountries.map((s, i) => [s.pays, fieldCashRecaps[i]]));

  return marketSettingsList.map((settings) => {
    const cod = codAggregates.get(settings.pays);
    const networkLivres = cod?.livres ?? 0;
    const recap = fieldCashByPays.get(settings.pays) ?? null;
    // Angola (2026-07-14) : AOV observé sur le total combiné Coliscod + Field Cash, cohérent avec
    // combineLivresCaLivre() utilisé en Trésorerie/Rentabilité — sinon l'AOV ignorerait tout le
    // volume Field Cash. Passthrough (cod seul) pour les 6 pays external_11usd.
    const { livres: combinedLivres, caLivre: combinedCaLivre } = combineLivresCaLivre(
      settings,
      networkLivres,
      cod?.caLivre ?? 0,
      recap
    );
    const aovObserved = combinedLivres > 0 ? combinedCaLivre / combinedLivres : null;

    // Taux de confirmation/livraison RÉELS observés sur les réseaux logistiques (2026-07-14,
    // demande CEO) — network-only (pas combinedLivres) : Field Cash n'a pas de notion de
    // "leads"/"confirmées", donc confPct/drPct restent basés uniquement sur le funnel COD.
    // drPctObserved = livres/confirmes (confirmé → livré), PAS livres/totalLeads (déjà un mix
    // conf%×dr%, affiché comme "Taux livraison" sur les pages réseaux) — sinon L = 1/(conf%×dr%)
    // compterait le taux de confirmation deux fois.
    const confPctObserved = cod && cod.totalLeads > 0 ? (cod.confirmes / cod.totalLeads) * 100 : null;
    const drPctObserved = cod && cod.confirmes > 0 ? (networkLivres / cod.confirmes) * 100 : null;

    const ads = adMetrics.get(settings.pays);
    const cplReelUsd = ads && ads.leads > 0 ? ads.spend / ads.leads : null;

    const aff = affiliatePayouts.get(settings.pays);
    const payoutReelUsd = aff && aff.confirmedOrders > 0 ? aff.totalPayoutUsd / aff.confirmedOrders : null;

    return computeThresholdRow(
      settings,
      aovObserved,
      cplReelUsd,
      payoutReelUsd,
      periodeReel,
      recap,
      networkLivres,
      confPctObserved,
      drPctObserved
    );
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
