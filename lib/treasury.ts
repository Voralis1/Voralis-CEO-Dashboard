import { aggregateCodNetworksByCountry, aggregateAdSpendByCountry, type OutOfScopeAdSpend } from "@/lib/profitability";
import { fetchMetaAdsByCountry } from "@/lib/supabase/queries";
import { fetchPublicMarketSettings, type PublicMarketSettings } from "@/lib/marketSettings";
import { fetchFieldCashRecap, resolveFraisLivraison, type FieldCashRecap } from "@/lib/fieldCash";
import { getCanonicalCountry } from "@/lib/countries";

// Cash encaissé par pays — base "livré + encaissé" (Prompt 1bis : le filtre date de dateFrom/
// dateTo est déjà appliqué sur la date de LIVRAISON via lib/providerKpi.ts, pas la création).
// frais_livraison_total est résolu via resolveFraisLivraison() de lib/fieldCash.ts — LA MÊME
// fonction qu'utilise /profitability, jamais une seconde implémentation.
export interface CashEncaisseRow {
  countryName: string;
  currency: string;
  livres: number;
  caLivre: number;
  fraisLivraisonTotal: number;
  cashEncaisse: number;
}

// cash_out_manual (salaires locaux/autre) retiré le 2026-07-08 : les 6 marchés à prestataire
// externe ont toutes leurs charges incluses dans les 11$ de frais de livraison, et l'Angola
// (interne) a désormais ses charges externes réelles dans Field Cash (voir /ceo/field-cash-angola,
// field_charges) — plus aucun pays n'a de "cash out manuel" à saisir. La table SQL cash_out_manual
// est conservée (historique) mais n'est plus lue ici.
export interface CashOutRow {
  countryName: string;
  currency: string;
  adSpendLocal: number;
  // Payout affilié CRM Voralis converti en devise locale — ACCRU sur les commandes confirmées/
  // livrées de la période, pas une date de décaissement réelle (le CRM n'expose aucune date de
  // paiement affilié).
  payoutAffilieLocal: number;
  total: number;
}

export interface TreasuryCashData {
  cashByCountry: CashEncaisseRow[];
  outOfScopeAdSpend: OutOfScopeAdSpend[];
  cashOutByCountry: CashOutRow[];
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
  const [aggregated, marketSettingsList, metaAdsRows, affiliatePayout] = await Promise.all([
    aggregateCodNetworksByCountry(dateFrom, dateTo),
    fetchPublicMarketSettings(),
    fetchMetaAdsByCountry(dateFrom, dateTo),
    fetchAffiliatePayoutUsdByCountry(dateFrom, dateTo),
  ]);

  const marketSettingsByPays = new Map<string, PublicMarketSettings>(marketSettingsList.map((s) => [s.pays, s]));
  const { byCountry: adSpendByCanonicalCountry, outOfScope: outOfScopeAdSpend } = aggregateAdSpendByCountry(metaAdsRows);

  // Angola (delivery_model = internal_real_cost) résout son frais de livraison via le recap
  // Field Cash, pas via deliveryFeeLocal() — voir lib/fieldCash.ts.
  const internalCostCountries = marketSettingsList.filter((s) => s.delivery_model === "internal_real_cost");
  const fieldCashRecaps = await Promise.all(internalCostCountries.map((s) => fetchFieldCashRecap(s.pays, dateFrom, dateTo)));
  const fieldCashByPays = new Map<string, FieldCashRecap>(internalCostCountries.map((s, i) => [s.pays, fieldCashRecaps[i]]));

  const cashByCountry: CashEncaisseRow[] = [];
  for (const [countryName, { livres, caLivre }] of aggregated) {
    const settings = marketSettingsByPays.get(countryName);
    if (!settings) continue;

    const { fraisLivraisonTotal } = resolveFraisLivraison(settings, livres, fieldCashByPays.get(countryName) ?? null);
    if (fraisLivraisonTotal == null) continue; // configuration Field Cash Angola incomplète — pas de cash encaissé fiable à afficher
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
    const payoutAffilieUsd = affiliatePayout.byCountry.get(settings.pays) ?? 0;
    const payoutAffilieLocal = payoutAffilieUsd * settings.fx_to_usd;

    if (adSpendLocal === 0 && payoutAffilieLocal === 0) continue; // rien à afficher pour ce pays

    cashOutByCountry.push({
      countryName: settings.pays,
      currency: settings.devise_locale,
      adSpendLocal,
      payoutAffilieLocal,
      total: adSpendLocal + payoutAffilieLocal,
    });
  }

  return {
    cashByCountry: cashByCountry.sort((a, b) => b.caLivre - a.caLivre),
    outOfScopeAdSpend,
    cashOutByCountry: cashOutByCountry.sort((a, b) => b.total - a.total),
    affiliatePayoutError: affiliatePayout.error,
  };
}