import { supabaseAdmin } from "@/lib/supabase/server";
import { getCanonicalCountry } from "@/lib/countries";
import { computeBaseMargin, finalizeMargin, type MarginBreakdown } from "@/lib/margin";
import { fetchPublicMarketSettings, type MarketSettings } from "@/lib/marketSettings";
import { computeAllThresholds, stripCeoDetail, type ThresholdRow } from "@/lib/thresholds";
import { computeInventoryThreshold, daysBetweenInclusive } from "@/lib/inventory";
import type { UserRole } from "@/lib/auth/role";

// Agrégateur SERVEUR UNIQUEMENT (jamais importé depuis un composant "use client") pour le
// copilot IA + les alertes proactives. Réutilise les moteurs déjà écrits (lib/margin.ts,
// lib/thresholds.ts) plutôt que de réimplémenter le calcul de marge — seule la donnée
// COGS/marge nette (équivalent ceoDetail de lib/thresholds.ts) est retirée
// pour le rôle "team", jamais calculée puis masquée côté client.
//
// Trous de source STRUCTURELS (permanents, pas liés à la période sélectionnée) — le copilot et
// les alertes doivent les signaler explicitement plutôt que de calculer sur un 0 implicite :
export const STRUCTURAL_BLIND_SPOTS: string[] = [
  "Délai avant le 1er contact commercial : aucune source connectée n'expose cette donnée (ni les réseaux COD, ni le CRM Voralis).",
  "Motifs d'annulation et de retour : aucun réseau ne catégorise ces motifs — seuls les comptages bruts (annulées, retournées) sont disponibles.",
  "CA encaissé par affilié : l'API CRM Voralis n'expose qu'un DR% et un payout global par affilié, jamais un chiffre d'affaires par pays/affilié — impossible de classer une commande affiliée comme rentable ou non.",
];

const COD_NETWORK_RPCS = [
  { network: "ClickMarket" as const, fn: "kpi_clickmarket_marche_periode" },
  { network: "Coliscod Angola" as const, fn: "kpi_coliscod_marche_periode" },
  { network: "Africod Congo" as const, fn: "kpi_africod_congo_marche_periode" },
] as const;

export type CodNetworkName = "ClickMarket" | "Coliscod Angola" | "Africod Congo" | "Shipsen";

export interface NetworkFunnelRow {
  network: CodNetworkName;
  pays: string;
  currency: string;
  totalLeads: number;
  doublons: number;
  confirmes: number;
  tauxConfirmation: number | null;
  livres: number;
  tauxLivraison: number | null;
  caLivre: number;
  enAttente: number;
  annulees: number;
  ruptureStock: number;
  // null = trou de source dur (aucune colonne retour) ; Shipsen a une colonne mais elle n'a
  // jamais été fiable à ce jour (cf. lib/providerKpi.ts, returnedDataStatus: "unreliable").
  retournees: number | null;
  retourneesReliable: boolean;
}

interface RawCodRow {
  country_name: string;
  total_leads: number;
  confirmes: number;
  taux_confirmation: number | null;
  livres: number;
  taux_livraison: number | null;
  ca_livre: number;
  en_attente: number;
  annulees: number;
  rupture_stock: number;
  doublons: number;
}

interface RawShipsenRow {
  country: string;
  total_orders: number;
  confirmed_orders: number;
  confirmation_rate: number | null;
  livres: number;
  taux_livraison: number | null;
  revenue_delivered: number;
  en_attente: number;
  annulees: number;
  rupture_stock: number;
  doublons: number;
  retournees: number;
}

async function fetchNetworkFunnelRows(
  dateFrom: string,
  dateTo: string,
  currencyByCountry: Map<string, string>
): Promise<NetworkFunnelRow[]> {
  const rows: NetworkFunnelRow[] = [];

  const codResults = await Promise.all(
    COD_NETWORK_RPCS.map((r) => supabaseAdmin.rpc(r.fn, { date_from: dateFrom, date_to: dateTo }))
  );
  for (let i = 0; i < COD_NETWORK_RPCS.length; i++) {
    const raw = (codResults[i].data ?? []) as RawCodRow[];
    for (const r of raw) {
      const canonical = getCanonicalCountry(r.country_name);
      if (!canonical) continue;
      rows.push({
        network: COD_NETWORK_RPCS[i].network,
        pays: canonical.name,
        currency: currencyByCountry.get(canonical.name) ?? canonical.currency,
        totalLeads: r.total_leads,
        doublons: r.doublons,
        confirmes: r.confirmes,
        tauxConfirmation: r.taux_confirmation,
        livres: r.livres,
        tauxLivraison: r.taux_livraison,
        caLivre: r.ca_livre,
        enAttente: r.en_attente,
        annulees: r.annulees,
        ruptureStock: r.rupture_stock,
        retournees: null,
        retourneesReliable: false,
      });
    }
  }

  const shipsenResult = await supabaseAdmin.rpc("kpi_shipsen_marche_periode", { date_from: dateFrom, date_to: dateTo });
  const shipsenRows = (shipsenResult.data ?? []) as RawShipsenRow[];
  for (const r of shipsenRows) {
    const canonical = getCanonicalCountry(r.country);
    if (!canonical) continue;
    rows.push({
      network: "Shipsen",
      pays: canonical.name,
      currency: currencyByCountry.get(canonical.name) ?? canonical.currency,
      totalLeads: r.total_orders,
      doublons: r.doublons,
      confirmes: r.confirmed_orders,
      tauxConfirmation: r.confirmation_rate,
      livres: r.livres,
      tauxLivraison: r.taux_livraison,
      caLivre: r.revenue_delivered,
      enAttente: r.en_attente,
      annulees: r.annulees,
      ruptureStock: r.rupture_stock,
      retournees: r.retournees,
      retourneesReliable: false, // colonne existe mais jamais renseignée de façon fiable à ce jour
    });
  }

  return rows;
}

// meta_ads_by_country a une ligne par (pays, canal, jour) avec une vraie colonne `date`
// (confirmé le 2026-07-06) — filtrage par période réel, plus un snapshot cumulatif.
async function fetchAdSpendUsdByCountry(dateFrom: string, dateTo: string): Promise<{ byCountry: Map<string, number>; known: Set<string> }> {
  const { data } = await supabaseAdmin
    .from("meta_ads_by_country")
    .select("country, spend")
    .gte("date", dateFrom)
    .lte("date", dateTo);
  const byCountry = new Map<string, number>();
  const known = new Set<string>();
  for (const row of (data ?? []) as { country: string; spend: number }[]) {
    const canonical = getCanonicalCountry(row.country);
    if (!canonical) continue;
    known.add(canonical.name);
    byCountry.set(canonical.name, (byCountry.get(canonical.name) ?? 0) + (row.spend ?? 0));
  }
  return { byCountry, known };
}

export interface AffiliateDetailRow {
  id: string;
  name: string;
  networkName: string;
  confirmedOrders: number;
  deliveredOrders: number;
  drPct: number | null;
  // Payé à la commande CONFIRMÉE, pas livrée (règle métier confirmée par le CEO, 2026-07-05 —
  // exception valable uniquement pour ce coût, cf. lib/affiliates.ts). null si confirmedOrders = 0.
  payoutPerConfirmedUsd: number | null;
}

export interface AffiliateCountryRow {
  pays: string;
  confirmedOrders: number;
  deliveredOrders: number;
  drPct: number | null;
  payoutPerConfirmedUsd: number | null;
}

interface CrmRawStats {
  total_orders: number;
  confirmed_orders: number;
  delivered_orders: number;
  total_payout: number;
}

function drPctOf(stats: CrmRawStats): number | null {
  if (stats.confirmed_orders <= 0) return null;
  return Math.round((stats.delivered_orders / stats.confirmed_orders) * 1000) / 10;
}

// Payout ÷ commandes CONFIRMÉES (pas livrées) — cf. note lib/affiliates.ts.
function payoutPerConfirmedOf(stats: CrmRawStats): number | null {
  if (stats.confirmed_orders <= 0) return null;
  return stats.total_payout / stats.confirmed_orders;
}

async function fetchAffiliateData(
  dateFrom: string,
  dateTo: string
): Promise<{ affiliates: AffiliateDetailRow[]; byCountry: AffiliateCountryRow[]; error: string | null }> {
  try {
    const url = new URL("https://www.voralisnatural.com/api/v1/reports/networks");
    url.searchParams.set("from", dateFrom);
    url.searchParams.set("to", dateTo);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.REPORTING_API_KEY}` }, cache: "no-store" });
    const json = await res.json();
    if (!json.success) return { affiliates: [], byCountry: [], error: json.message ?? "Erreur CRM Voralis" };

    const affiliates: AffiliateDetailRow[] = [];
    for (const network of json.networks ?? []) {
      for (const aff of network.affiliates ?? []) {
        const s: CrmRawStats = aff.stats;
        affiliates.push({
          id: aff.id,
          name: aff.name,
          networkName: network.name,
          confirmedOrders: s.confirmed_orders,
          deliveredOrders: s.delivered_orders,
          drPct: drPctOf(s),
          payoutPerConfirmedUsd: payoutPerConfirmedOf(s),
        });
      }
    }

    const byCountry: AffiliateCountryRow[] = (json.by_country ?? []).map((row: { country: string; stats: CrmRawStats }) => {
      const canonical = getCanonicalCountry(row.country);
      return {
        pays: canonical?.name ?? row.country,
        confirmedOrders: row.stats.confirmed_orders,
        deliveredOrders: row.stats.delivered_orders,
        drPct: drPctOf(row.stats),
        payoutPerConfirmedUsd: payoutPerConfirmedOf(row.stats),
      };
    });

    return { affiliates, byCountry, error: null };
  } catch (err) {
    return { affiliates: [], byCountry: [], error: err instanceof Error ? err.message : "CRM Voralis injoignable." };
  }
}

export interface StockProductRow {
  produit: string;
  quantiteStock: number;
  seuilAlerte: number | null;
  statut: "ok" | "a_commander" | "rupture" | "non_configure";
  tauxRuptureStock: number | null; // ClickMarket uniquement — null = non disponible, jamais 0
}

interface RawProduitRow {
  country_name?: string;
  country?: string;
  product_name: string;
  total_leads?: number;
  total_orders?: number;
  rupture_stock: number;
  taux_rupture_stock: number | null;
  livres: number;
}

async function fetchStockByCountry(dateFrom: string, dateTo: string, nbJours: number): Promise<Map<string, StockProductRow[]>> {
  const merged = new Map<string, { pays: string; produit: string; livres: number; tauxRuptureStock: number | null }>();

  function merge(rawCountry: string | undefined, produit: string, livres: number, tauxRuptureStock: number | null) {
    if (!rawCountry) return;
    const canonical = getCanonicalCountry(rawCountry);
    if (!canonical) return;
    const key = `${canonical.name}__${produit}`;
    const existing = merged.get(key);
    if (existing) {
      existing.livres += livres;
      if (existing.tauxRuptureStock == null && tauxRuptureStock != null) existing.tauxRuptureStock = tauxRuptureStock;
    } else {
      merged.set(key, { pays: canonical.name, produit, livres, tauxRuptureStock });
    }
  }

  const [cm, cs, ac, sh, inventoryRes] = await Promise.all([
    supabaseAdmin.rpc("kpi_clickmarket_par_produit_periode", { date_from: dateFrom, date_to: dateTo }),
    supabaseAdmin.rpc("kpi_coliscod_par_produit_periode", { date_from: dateFrom, date_to: dateTo }),
    supabaseAdmin.rpc("kpi_africod_congo_par_produit_periode", { date_from: dateFrom, date_to: dateTo }),
    supabaseAdmin.rpc("kpi_shipsen_par_produit_periode", { date_from: dateFrom, date_to: dateTo }),
    supabaseAdmin.from("inventory").select("*"),
  ]);

  for (const row of (cm.data ?? []) as RawProduitRow[]) merge(row.country_name, row.product_name, row.livres, row.taux_rupture_stock);
  for (const row of (cs.data ?? []) as RawProduitRow[]) merge(row.country_name, row.product_name, row.livres, row.taux_rupture_stock);
  for (const row of (ac.data ?? []) as RawProduitRow[]) merge(row.country_name, row.product_name, row.livres, row.taux_rupture_stock);
  for (const row of (sh.data ?? []) as RawProduitRow[]) merge(row.country, row.product_name, row.livres, row.taux_rupture_stock);

  const inventoryRows = (inventoryRes.data ?? []) as {
    pays: string;
    produit: string;
    quantite_stock: number;
    delai_appro_jours: number | null;
    stock_securite: number | null;
    ventes_moyennes_jour_override: number | null;
  }[];

  const byCountry = new Map<string, StockProductRow[]>();
  for (const inv of inventoryRows) {
    const stats = merged.get(`${inv.pays}__${inv.produit}`);
    const ventesObservees = (stats?.livres ?? 0) / nbJours;
    const threshold = computeInventoryThreshold(
      inv.quantite_stock,
      inv.delai_appro_jours,
      inv.stock_securite,
      ventesObservees,
      inv.ventes_moyennes_jour_override
    );
    const list = byCountry.get(inv.pays) ?? [];
    list.push({
      produit: inv.produit,
      quantiteStock: inv.quantite_stock,
      seuilAlerte: threshold.seuilAlerte,
      statut: threshold.statut,
      tauxRuptureStock: stats?.tauxRuptureStock ?? null,
    });
    byCountry.set(inv.pays, list);
  }

  return byCountry;
}

export interface CashHoldingRow {
  entite: string;
  montantDetenu: number;
  statutRapatriement: "en_attente" | "en_cours" | "rapatrie";
  dateDerniereRemise: string | null;
}

async function fetchCashHoldingsByCountry(): Promise<Map<string, CashHoldingRow[]>> {
  const { data } = await supabaseAdmin.from("cash_holdings").select("*");
  const byCountry = new Map<string, CashHoldingRow[]>();
  for (const row of (data ?? []) as {
    pays: string;
    entite: string;
    montant_detenu: number;
    statut_rapatriement: "en_attente" | "en_cours" | "rapatrie";
    date_derniere_remise: string | null;
  }[]) {
    const canonical = getCanonicalCountry(row.pays);
    const pays = canonical?.name ?? row.pays;
    const list = byCountry.get(pays) ?? [];
    list.push({
      entite: row.entite,
      montantDetenu: row.montant_detenu,
      statutRapatriement: row.statut_rapatriement,
      dateDerniereRemise: row.date_derniere_remise,
    });
    byCountry.set(pays, list);
  }
  return byCountry;
}

export interface MediaBuyingSnapshot {
  adSpendUsd: number;
  adSpendKnown: boolean;
  // Présent uniquement pour le rôle CEO — retiré entièrement pour "team" (cf. ThresholdRow.ceoDetail).
  margin?: MarginBreakdown;
}

export interface MarketSnapshot {
  pays: string;
  currency: string;
  fxToUsd: number;
  funnel: NetworkFunnelRow[];
  funnelTotals: {
    totalLeads: number;
    confirmes: number;
    tauxConfirmation: number | null;
    livres: number;
    tauxLivraison: number | null;
    caLivre: number;
    enAttente: number;
    annulees: number;
    ruptureStock: number;
    doublons: number;
  };
  mediaBuying: MediaBuyingSnapshot;
  threshold: Omit<ThresholdRow, "ceoDetail"> & { ceoDetail?: ThresholdRow["ceoDetail"] };
  affiliatesCountry: AffiliateCountryRow | null;
  stockProducts: StockProductRow[];
  cashHoldings: CashHoldingRow[];
}

export interface CopilotSnapshot {
  role: UserRole;
  periode: { dateFrom: string; dateTo: string; nbJours: number };
  markets: MarketSnapshot[];
  affiliateNetworks: AffiliateDetailRow[];
  affiliatesError: string | null;
  blindSpots: string[];
}

// Point d'entrée UNIQUE du copilot + des alertes proactives — jamais appelé depuis le navigateur
// (importe supabaseAdmin). Le paramètre `role` détermine si ceoDetail (marge, COGS, T) est
// calculé ET renvoyé, ou entièrement omis — jamais calculé puis filtré côté client.
export async function buildCopilotSnapshot(dateFrom: string, dateTo: string, role: UserRole): Promise<CopilotSnapshot> {
  const nbJours = daysBetweenInclusive(dateFrom, dateTo);

  const [marketSettingsRes, publicSettings, adSpend, affiliateData, thresholds] = await Promise.all([
    supabaseAdmin.from("market_settings").select("*").order("pays"),
    fetchPublicMarketSettings(),
    fetchAdSpendUsdByCountry(dateFrom, dateTo),
    fetchAffiliateData(dateFrom, dateTo),
    computeAllThresholds(dateFrom, dateTo),
  ]);

  const marketSettingsList = (marketSettingsRes.data ?? []) as MarketSettings[];
  const currencyByCountry = new Map<string, string>(publicSettings.map((s) => [s.pays, s.devise_locale] as [string, string]));

  const funnelRows = await fetchNetworkFunnelRows(dateFrom, dateTo, currencyByCountry);
  const stockByCountry = await fetchStockByCountry(dateFrom, dateTo, nbJours);
  const cashByCountry = await fetchCashHoldingsByCountry();

  const affiliatesCountryMap = new Map(affiliateData.byCountry.map((r) => [r.pays, r]));
  const thresholdByCountry = new Map(thresholds.map((t) => [t.pays, t]));

  const markets: MarketSnapshot[] = [];
  for (const settings of marketSettingsList) {
    const rowsForCountry = funnelRows.filter((r) => r.pays === settings.pays);
    const livres = rowsForCountry.reduce((s, r) => s + r.livres, 0);
    const caLivre = rowsForCountry.reduce((s, r) => s + r.caLivre, 0);
    const totalLeads = rowsForCountry.reduce((s, r) => s + r.totalLeads, 0);
    const confirmes = rowsForCountry.reduce((s, r) => s + r.confirmes, 0);

    const adSpendUsd = adSpend.byCountry.get(settings.pays) ?? 0;
    const adSpendKnown = adSpend.known.has(settings.pays);
    const adSpendLocal = adSpendUsd * settings.fx_to_usd;

    const base = computeBaseMargin(livres, caLivre, settings);
    const margin = finalizeMargin(base, livres, adSpendLocal, "ad spend (Media Buying Interne)");

    const thresholdRow = thresholdByCountry.get(settings.pays);

    markets.push({
      pays: settings.pays,
      currency: settings.devise_locale,
      fxToUsd: settings.fx_to_usd,
      funnel: rowsForCountry,
      funnelTotals: {
        totalLeads,
        confirmes,
        tauxConfirmation: confirmes > 0 && totalLeads > 0 ? Math.round((confirmes / totalLeads) * 1000) / 10 : null,
        livres,
        tauxLivraison: livres > 0 && confirmes > 0 ? Math.round((livres / confirmes) * 1000) / 10 : null,
        caLivre,
        enAttente: rowsForCountry.reduce((s, r) => s + r.enAttente, 0),
        annulees: rowsForCountry.reduce((s, r) => s + r.annulees, 0),
        ruptureStock: rowsForCountry.reduce((s, r) => s + r.ruptureStock, 0),
        doublons: rowsForCountry.reduce((s, r) => s + r.doublons, 0),
      },
      mediaBuying: { adSpendUsd, adSpendKnown, margin: role === "ceo" ? margin : undefined },
      threshold: role === "ceo" ? (thresholdRow as ThresholdRow) : (stripCeoDetail(thresholdRow ? [thresholdRow] : [])[0] as Omit<ThresholdRow, "ceoDetail">),
      affiliatesCountry: affiliatesCountryMap.get(settings.pays) ?? null,
      stockProducts: stockByCountry.get(settings.pays) ?? [],
      cashHoldings: cashByCountry.get(settings.pays) ?? [],
    });
  }

  return {
    role,
    periode: { dateFrom, dateTo, nbJours },
    markets,
    affiliateNetworks: affiliateData.affiliates,
    affiliatesError: affiliateData.error,
    blindSpots: STRUCTURAL_BLIND_SPOTS,
  };
}
