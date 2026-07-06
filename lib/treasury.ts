import { aggregateCodNetworksByCountry, aggregateAdSpendByCountry, type OutOfScopeAdSpend } from "@/lib/profitability";
import { fetchMetaAdsByCountry } from "@/lib/supabase/queries";
import { deliveryFeeLocal, fetchPublicMarketSettings, type PublicMarketSettings } from "@/lib/marketSettings";
import { fetchCashOutManual, type CashOutManual } from "@/lib/cashOps";
import { getCanonicalCountry } from "@/lib/countries";

// Cash encaissé par pays — base "livré + encaissé" (Prompt 1bis : le filtre date de dateFrom/
// dateTo est déjà appliqué sur la date de LIVRAISON via lib/providerKpi.ts, pas la création).
// frais_livraison_total utilise deliveryFeeLocal() de lib/marketSettings.ts — LA MÊME fonction
// qu'utilise /profitability, jamais une seconde implémentation.
export interface CashEncaisseRow {
  countryName: string;
  currency: string;
  livres: number;
  caLivre: number;
  fraisLivraisonTotal: number;
  cashEncaisse: number;
}

export interface CashOutRow {
  countryName: string;
  currency: string;
  adSpendLocal: number;
  salaireLocal: number;
  autre: number;
  // Payout affilié CRM Voralis converti en devise locale — ACCRU sur les commandes confirmées/
  // livrées de la période, pas une date de décaissement réelle (le CRM n'expose aucune date de
  // paiement affilié). Inclus dans `total` sur demande explicite du CEO malgré cette
  // approximation accru≈décaissé (déjà implicitement acceptée pour l'ad spend, dont le filtrage
  // par période est lui aussi approximatif — cf. fetchMetaAdsByCountry).
  payoutAffilieLocal: number;
  total: number;
}

export interface TreasuryCashData {
  cashByCountry: CashEncaisseRow[];
  outOfScopeAdSpend: OutOfScopeAdSpend[];
  cashOutByCountry: CashOutRow[];
  cashOutManualEntries: CashOutManual[];
  affiliatePayoutError: string | null;
}

// CRM Voralis (by_country) — payout affilié en USD, converti en devise locale via fx_to_usd
// (même principe que aggregateAdSpendByCountry). Voir lib/affiliates.ts pour le contrat exact
// de l'API (by_country = vue globale tous affiliés confondus par pays, payout toujours en USD).
async function fetchAffiliatePayoutUsdByCountry(dateFrom: string, dateTo: string): Promise<{ byCountry: Map<string, number>; error: string | null }> {
  const byCountry = new Map<string, number>();
  try {
    const res = await fetch(`/api/networks?dateFrom=${dateFrom}&dateTo=${dateTo}`);
    const json = await res.json();
    if (!json.success) return { byCountry, error: json.message ?? "Erreur CRM Voralis" };

    for (const row of (json.by_country ?? []) as { country: string; stats: { total_payout: number } }[]) {
      const canonical = getCanonicalCountry(row.country);
      if (!canonical) continue;
      byCountry.set(canonical.name, (byCountry.get(canonical.name) ?? 0) + (row.stats.total_payout ?? 0));
    }
    return { byCountry, error: null };
  } catch (err) {
    return { byCountry, error: err instanceof Error ? err.message : "CRM Voralis injoignable." };
  }
}

export async function fetchTreasuryCashData(dateFrom: string, dateTo: string): Promise<TreasuryCashData> {
  const [aggregated, marketSettingsList, metaAdsRows, cashOutManualEntries, affiliatePayout] = await Promise.all([
    aggregateCodNetworksByCountry(dateFrom, dateTo),
    fetchPublicMarketSettings(),
    fetchMetaAdsByCountry(dateFrom, dateTo),
    fetchCashOutManual(),
    fetchAffiliatePayoutUsdByCountry(dateFrom, dateTo),
  ]);

  const marketSettingsByPays = new Map<string, PublicMarketSettings>(marketSettingsList.map((s) => [s.pays, s]));
  const { byCountry: adSpendByCanonicalCountry, outOfScope: outOfScopeAdSpend } = aggregateAdSpendByCountry(metaAdsRows);

  const cashByCountry: CashEncaisseRow[] = [];
  for (const [countryName, { livres, caLivre }] of aggregated) {
    const settings = marketSettingsByPays.get(countryName);
    if (!settings) continue;

    const fraisLivraisonTotal = livres * deliveryFeeLocal(settings.fx_to_usd);
    cashByCountry.push({
      countryName,
      currency: settings.devise_locale,
      livres,
      caLivre,
      fraisLivraisonTotal,
      cashEncaisse: caLivre - fraisLivraisonTotal,
    });
  }

  const cashOutByCountry: CashOutRow[] = [];
  for (const settings of marketSettingsList) {
    const adSpendUsd = adSpendByCanonicalCountry.get(settings.pays) ?? 0;
    const adSpendLocal = adSpendUsd * settings.fx_to_usd;
    const manualForCountry = cashOutManualEntries.filter((e) => e.pays === settings.pays);
    const salaireLocal = manualForCountry.filter((e) => e.type === "salaire_local").reduce((s, e) => s + e.montant, 0);
    const autre = manualForCountry.filter((e) => e.type === "autre").reduce((s, e) => s + e.montant, 0);
    const payoutAffilieUsd = affiliatePayout.byCountry.get(settings.pays) ?? 0;
    const payoutAffilieLocal = payoutAffilieUsd * settings.fx_to_usd;

    if (adSpendLocal === 0 && salaireLocal === 0 && autre === 0 && payoutAffilieLocal === 0) continue; // rien à afficher pour ce pays

    cashOutByCountry.push({
      countryName: settings.pays,
      currency: settings.devise_locale,
      adSpendLocal,
      salaireLocal,
      autre,
      payoutAffilieLocal,
      total: adSpendLocal + salaireLocal + autre + payoutAffilieLocal,
    });
  }

  return {
    cashByCountry: cashByCountry.sort((a, b) => b.caLivre - a.caLivre),
    outOfScopeAdSpend,
    cashOutByCountry: cashOutByCountry.sort((a, b) => b.total - a.total),
    cashOutManualEntries,
    affiliatePayoutError: affiliatePayout.error,
  };
}
