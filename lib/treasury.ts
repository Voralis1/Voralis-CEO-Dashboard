import { aggregateCodNetworksByCountry, aggregateAdSpendByCountry } from "@/lib/profitability";
import { fetchMetaAdsByCountry, fetchQuantitySentByCountry } from "@/lib/supabase/queries";
import { fetchPublicMarketSettings, type PublicMarketSettings } from "@/lib/marketSettings";
import { fetchFieldCashRecap, resolveFraisLivraison, combineLivresCaLivre, type FieldCashRecap } from "@/lib/fieldCash";
import { getCanonicalCountry } from "@/lib/countries";
import { COGS_PRODUCTION_UNIT_USD, COGS_SHIPPING_UNIT_USD } from "@/lib/margin";

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
  // Coût produit expédié (production + livraison fournisseur→warehouse) × quantité envoyée sur
  // la période — voir COGS_PRODUCTION_UNIT_USD/COGS_SHIPPING_UNIT_USD ci-dessus. Distinct du
  // frais logistique ci-dessous (qui lui porte sur la LIVRAISON commande→client).
  cogsLocal: number;
  // Frais logistique commande→client : 11$/livraison (deliveryFeeLocal) pour les 6 réseaux
  // externes, frais interne + charges externes (Field Cash) pour l'Angola — même calcul que
  // "Frais livraison" de Cash encaissé (resolveFraisLivraison), affiché ici comme sortie de
  // cash explicite plutôt que seulement netté contre le CA livré encaissé.
  fraisLogistiqueLocal: number;
  total: number;
}

export interface TreasuryCashData {
  cashByCountry: CashEncaisseRow[];
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
  const [aggregated, marketSettingsList, metaAdsRows, affiliatePayout, quantitySentByCountry] = await Promise.all([
    aggregateCodNetworksByCountry(dateFrom, dateTo),
    fetchPublicMarketSettings(),
    fetchMetaAdsByCountry(dateFrom, dateTo),
    fetchAffiliatePayoutUsdByCountry(dateFrom, dateTo),
    fetchQuantitySentByCountry(dateFrom, dateTo),
  ]);

  const marketSettingsByPays = new Map<string, PublicMarketSettings>(marketSettingsList.map((s) => [s.pays, s]));
  const { byCountry: adSpendByCanonicalCountry, outOfScope: outOfScopeAdSpend } = aggregateAdSpendByCountry(metaAdsRows);

  // Angola (delivery_model = internal_real_cost) résout son frais de livraison via le recap
  // Field Cash, pas via deliveryFeeLocal() — voir lib/fieldCash.ts.
  const internalCostCountries = marketSettingsList.filter((s) => s.delivery_model === "internal_real_cost");
  const fieldCashRecaps = await Promise.all(internalCostCountries.map((s) => fetchFieldCashRecap(s.pays, dateFrom, dateTo)));
  const fieldCashByPays = new Map<string, FieldCashRecap>(internalCostCountries.map((s, i) => [s.pays, fieldCashRecaps[i]]));

  const cashByCountry: CashEncaisseRow[] = [];
  for (const [countryName, { livres: networkLivres, caLivre: networkCaLivre }] of aggregated) {
    const settings = marketSettingsByPays.get(countryName);
    if (!settings) continue;

    const recap = fieldCashByPays.get(countryName) ?? null;
    const { fraisLivraisonTotal } = resolveFraisLivraison(settings, networkLivres, recap);
    if (fraisLivraisonTotal == null) continue; // configuration Field Cash Angola incomplète — pas de cash encaissé fiable à afficher
    // Angola (2026-07-14) : Coliscod + Field Cash sont deux canaux distincts, additionnés pour
    // le vrai total — voir combineLivresCaLivre(). Passthrough pour les 6 autres pays.
    const { livres, caLivre } = combineLivresCaLivre(settings, networkLivres, networkCaLivre, recap);
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

    const quantitySent = quantitySentByCountry.get(settings.pays) ?? 0;
    const cogsLocal = (COGS_PRODUCTION_UNIT_USD + COGS_SHIPPING_UNIT_USD) * quantitySent * settings.fx_to_usd;

    // Même calcul que "Frais livraison" de Cash encaissé ci-dessus (resolveFraisLivraison) :
    // 11$/livraison pour les 6 réseaux externes, frais interne + charges externes pour l'Angola.
    const { livres } = aggregated.get(settings.pays) ?? { livres: 0, caLivre: 0 };
    const { fraisLivraisonTotal, chargesExternesTotal } = resolveFraisLivraison(
      settings,
      livres,
      fieldCashByPays.get(settings.pays) ?? null
    );
    const fraisLogistiqueLocal = (fraisLivraisonTotal ?? 0) + (chargesExternesTotal ?? 0);

    if (adSpendLocal === 0 && payoutAffilieLocal === 0 && cogsLocal === 0 && fraisLogistiqueLocal === 0) continue; // rien à afficher pour ce pays

    cashOutByCountry.push({
      countryName: settings.pays,
      currency: settings.devise_locale,
      adSpendLocal,
      payoutAffilieLocal,
      cogsLocal,
      fraisLogistiqueLocal,
      total: adSpendLocal + payoutAffilieLocal + cogsLocal + fraisLogistiqueLocal,
    });
  }

  // Pays hors périmètre COD : pas de market_settings, donc pas de FX/devise locale possible —
  // affiché directement en USD (devise native de Meta Ads) plutôt qu'exclu. Depuis 2026-07,
  // Burkina Faso et Maroc ont leur propre market_settings (voir lib/countries.ts) et ne passent
  // donc plus par cette branche — elle ne devrait plus se déclencher en pratique, gardée pour
  // tout futur pays de prospection Meta Ads pas encore onboardé.
  for (const { country, spendUsd } of outOfScopeAdSpend) {
    if (spendUsd === 0) continue;
    cashOutByCountry.push({
      countryName: country,
      currency: "USD",
      adSpendLocal: spendUsd,
      payoutAffilieLocal: 0,
      cogsLocal: 0,
      fraisLogistiqueLocal: 0,
      total: spendUsd,
    });
  }

  return {
    cashByCountry: cashByCountry.sort((a, b) => b.caLivre - a.caLivre),
    cashOutByCountry: cashOutByCountry.sort((a, b) => b.total - a.total),
    affiliatePayoutError: affiliatePayout.error,
  };
}