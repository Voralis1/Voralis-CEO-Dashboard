import { PROVIDERS } from "@/lib/providerKpi";
import { fetchMetaAdsByCountry, fetchQuantitySentByCountry } from "@/lib/supabase/queries";
import { fetchMarketSettings, type MarketSettings } from "@/lib/marketSettings";
import { computeBaseMargin, finalizeMargin, COGS_PRODUCTION_UNIT_USD, COGS_SHIPPING_UNIT_USD, type MarginBreakdown } from "@/lib/margin";
import { fetchFieldCashRecap, resolveFraisLivraison, combineLivresCaLivre, type FieldCashRecap } from "@/lib/fieldCash";
import { getCanonicalCountry } from "@/lib/countries";

// "Media Buying Interne" = les 4 réseaux COD (ClickMarket/Coliscod/Africod Congo/Shipsen),
// dont l'acquisition est aujourd'hui portée par Meta Ads (pas d'affiliés dans cette base).
// Hypothèse de travail à confirmer : si un jour un réseau COD est alimenté par un canal
// d'acquisition distinct, il faudra une colonne "source" dans les tables *_leads/*_orders
// pour ne plus la déduire implicitement ici.
export interface MediaBuyingCountryRow {
  countryName: string;
  currency: string;
  livres: number;
  caLivre: number;
  adSpendLocal: number;
  adSpendKnown: boolean; // false = pas de ligne meta_ads pour ce pays (0 par défaut, pas un trou)
  margin: MarginBreakdown;
}

export interface OutOfScopeAdSpend {
  country: string; // nom brut tel que renvoyé par meta_ads_by_country
  spendUsd: number;
}

// CRM Voralis (affiliés marketing) — le payout est désormais exact et fiable : total_payout
// (by_country / networks) est la somme exacte des commissions en USD (project_products.payout,
// propagée correctement dès l'ingestion côté CRM), pour toute commande ayant atteint au moins
// le statut "confirmed" — confirmé le 2026-07-06. Seul le CA par réseau affilié reste absent de
// l'API : impossible de calculer une marge nette sans lui (cf. bannière dans la page).
export interface AffiliateNetworkRow {
  networkName: string;
  totalOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;
  totalPayout: number | null;
  // total_payout ÷ confirmées (payé à la confirmation, pas à la livraison — cf. lib/affiliates.ts).
  payoutPerConfirmedUsd: number | null;
}

export interface ProfitabilityData {
  mediaBuying: MediaBuyingCountryRow[];
  outOfScopeAdSpend: OutOfScopeAdSpend[];
  affiliates: AffiliateNetworkRow[];
  affiliatesError: string | null;
}

// Agrège les 4 réseaux COD par pays canonique — réutilisé par /profitability (Media Buying
// Interne) et /ceo (cash encaissé), pour ne pas dupliquer cette logique entre les deux écrans.
export async function aggregateCodNetworksByCountry(
  dateFrom: string,
  dateTo: string
): Promise<Map<string, { livres: number; caLivre: number }>> {
  const providerRowsByNetwork = await Promise.all(
    Object.keys(PROVIDERS).map((id) => PROVIDERS[id as keyof typeof PROVIDERS].fetchRows(dateFrom, dateTo))
  );

  const aggregated = new Map<string, { livres: number; caLivre: number }>();
  for (const rows of providerRowsByNetwork) {
    for (const row of rows) {
      const entry = aggregated.get(row.countryName) ?? { livres: 0, caLivre: 0 };
      entry.livres += row.livres;
      entry.caLivre += row.caLivre;
      aggregated.set(row.countryName, entry);
    }
  }
  return aggregated;
}

// Dépense Meta Ads par pays canonique (USD, devise native de la source) — réutilisé par
// /profitability et /ceo (Cash Out). Les pays hors périmètre COD (pas de market_settings, ex.
// Maroc/BF) sont renvoyés à part : pas de FX possible, jamais mélangés au calcul par pays.
export function aggregateAdSpendByCountry(metaAdsRows: { country: string; spend: number }[]): {
  byCountry: Map<string, number>;
  outOfScope: OutOfScopeAdSpend[];
} {
  const byCountry = new Map<string, number>();
  const outOfScopeAgg = new Map<string, number>();
  for (const row of metaAdsRows) {
    const canonical = getCanonicalCountry(row.country);
    if (!canonical) {
      outOfScopeAgg.set(row.country, (outOfScopeAgg.get(row.country) ?? 0) + (row.spend ?? 0));
      continue;
    }
    byCountry.set(canonical.name, (byCountry.get(canonical.name) ?? 0) + (row.spend ?? 0));
  }
  const outOfScope = [...outOfScopeAgg].map(([country, spendUsd]) => ({ country, spendUsd }));
  return { byCountry, outOfScope };
}

async function fetchAffiliateNetworks(dateFrom: string, dateTo: string): Promise<{ rows: AffiliateNetworkRow[]; error: string | null }> {
  try {
    const res = await fetch(`/api/networks?dateFrom=${dateFrom}&dateTo=${dateTo}`);
    const json = await res.json();
    if (!json.success) return { rows: [], error: json.message ?? "Erreur CRM Voralis" };

    const rows: AffiliateNetworkRow[] = (json.networks ?? []).map(
      (n: { name: string; stats: { total_orders: number; confirmed_orders: number; delivered_orders: number; total_payout: number } }) => ({
        networkName: n.name,
        totalOrders: n.stats.total_orders,
        confirmedOrders: n.stats.confirmed_orders,
        deliveredOrders: n.stats.delivered_orders,
        totalPayout: n.stats.total_payout ?? null,
        payoutPerConfirmedUsd: n.stats.confirmed_orders > 0 ? n.stats.total_payout / n.stats.confirmed_orders : null,
      })
    );
    return { rows, error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : "Impossible de contacter le CRM Voralis." };
  }
}

export async function fetchProfitabilityData(dateFrom: string, dateTo: string): Promise<ProfitabilityData> {
  const [aggregated, marketSettingsList, metaAdsRows, affiliates, quantitySentByCountry] = await Promise.all([
    aggregateCodNetworksByCountry(dateFrom, dateTo),
    fetchMarketSettings(),
    fetchMetaAdsByCountry(dateFrom, dateTo),
    fetchAffiliateNetworks(dateFrom, dateTo),
    fetchQuantitySentByCountry(dateFrom, dateTo),
  ]);

  const marketSettingsByPays = new Map<string, MarketSettings>(marketSettingsList.map((s) => [s.pays, s]));
  const { byCountry: adSpendByCanonicalCountry, outOfScope: outOfScopeAdSpend } = aggregateAdSpendByCountry(metaAdsRows);

  // Angola (delivery_model = internal_real_cost) a besoin du recap Field Cash pour résoudre ses
  // frais de livraison réels — les 6 autres pays n'en ont pas besoin (resolveFraisLivraison les
  // ignore). Chargé une seule fois par pays concerné, pas par ligne.
  const internalCostCountries = marketSettingsList.filter((s) => s.delivery_model === "internal_real_cost");
  const fieldCashRecaps = await Promise.all(internalCostCountries.map((s) => fetchFieldCashRecap(s.pays, dateFrom, dateTo)));
  const fieldCashByPays = new Map<string, FieldCashRecap>(internalCostCountries.map((s, i) => [s.pays, fieldCashRecaps[i]]));

  const mediaBuying: MediaBuyingCountryRow[] = [];
  for (const [countryName, { livres: networkLivres, caLivre: networkCaLivre }] of aggregated) {
    const settings = marketSettingsByPays.get(countryName);
    if (!settings) continue; // pas de market_settings pour ce pays — ne devrait pas arriver (7 pays couverts)

    const adSpendUsd = adSpendByCanonicalCountry.get(countryName) ?? 0;
    const adSpendKnown = adSpendByCanonicalCountry.has(countryName);
    const adSpendLocal = adSpendUsd * settings.fx_to_usd;

    const recap = fieldCashByPays.get(countryName) ?? null;
    const { fraisLivraisonTotal, chargesExternesTotal } = resolveFraisLivraison(settings, networkLivres, recap);
    // Angola (2026-07-14) : Coliscod + Field Cash sont deux canaux distincts, additionnés pour
    // le vrai total (demande CEO) — voir combineLivresCaLivre(). Passthrough pour les 6 autres pays.
    const { livres, caLivre } = combineLivresCaLivre(settings, networkLivres, networkCaLivre, recap);
    // COGS (2026-07-14, demande CEO) : ne se saisit plus manuellement — même formule que "Cash
    // Out par pays" en Trésorerie, quantité physiquement expédiée × 15$/unité.
    const quantitySent = quantitySentByCountry.get(countryName) ?? 0;
    const cogsTotal = (COGS_PRODUCTION_UNIT_USD + COGS_SHIPPING_UNIT_USD) * quantitySent * settings.fx_to_usd;
    const base = computeBaseMargin(caLivre, settings, fraisLivraisonTotal, chargesExternesTotal, cogsTotal);
    const margin = finalizeMargin(base, livres, adSpendLocal, "ad spend");

    mediaBuying.push({
      countryName,
      currency: settings.devise_locale,
      livres,
      caLivre,
      adSpendLocal,
      adSpendKnown,
      margin,
    });
  }

  return {
    mediaBuying: mediaBuying.sort((a, b) => b.caLivre - a.caLivre),
    outOfScopeAdSpend,
    affiliates: affiliates.rows,
    affiliatesError: affiliates.error,
  };
}
