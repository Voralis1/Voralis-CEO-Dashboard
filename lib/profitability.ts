import { PROVIDERS } from "@/lib/providerKpi";
import { fetchMetaAdsByCountry, fetchQuantitySentByCountry } from "@/lib/supabase/queries";
import { fetchMarketSettings, type MarketSettings } from "@/lib/marketSettings";
import { computeBaseMargin, finalizeMargin, COGS_PRODUCTION_UNIT_USD, COGS_SHIPPING_UNIT_USD, type MarginBreakdown } from "@/lib/margin";
import { fetchFieldCashRecap, resolveFraisLivraison, combineLivresCaLivre, type FieldCashRecap } from "@/lib/fieldCash";
import { getCanonicalCountry } from "@/lib/countries";

// "Rentabilité" = toutes les commandes livrées par les 7 réseaux COD (ClickMarket/Coliscod/
// Africod Congo/Shipsen/ShipLead/MLShipAfrica/Ikatchiexpress), TOUTES affiliations confondues
// (media buying interne Meta Ads + affiliés externes CRM Voralis). Décision CEO (2026-08-05) :
// vu que la même commande apparaît à la fois dans la table du réseau logistique ET dans le CRM
// Voralis quand elle vient d'un affilié, il est inutile de les séparer — la vraie rentabilité par
// pays se lit directement sur le total réseau (source de vérité "partenaires logistiques"), avec
// TOUS les coûts d'acquisition déduits en face : ad spend (Meta Ads) ET payout affiliés (CRM
// Voralis), qu'importe quel canal a effectivement apporté chaque commande.
export interface MediaBuyingCountryRow {
  countryName: string;
  currency: string;
  livres: number;
  caLivre: number;
  adSpendLocal: number;
  adSpendKnown: boolean; // false = pas de ligne meta_ads pour ce pays (0 par défaut, pas un trou)
  // Payout CRM Voralis (bloc by_country, toujours en USD) converti en devise locale via
  // fx_to_usd — 0 si aucun affilié n'a livré sur ce pays/période (pas un trou de source).
  payoutAffiliesLocal: number;
  margin: MarginBreakdown;
  // Devise locale -> USD (2026-08-04, affichage /profitability en dollars) : local / fxToUsd.
  // Uniquement pour l'AFFICHAGE, ligne par ligne — jamais pour additionner entre pays (le calcul
  // de marge lui-même reste en devise locale, cf. computeBaseMargin/finalizeMargin ci-dessous).
  // null = pas de taux fiable (pays hors market_settings ET devise source non alignée sur un pays
  // déjà configuré, ex. Argentine — voir fetchProfitabilityData).
  fxToUsd: number | null;
  // false = pays sans ligne market_settings (ex. Cameroun, Argentine — nouveaux réseaux
  // logistiques 2026-08, pas encore configurés). Toujours affiché (2026-08-04, demande CEO :
  // "afficher tous les pays présents au niveau des partenaires logistiques"), mais marge/USD
  // possiblement incomplets — jamais masqué silencieusement comme avant (continue muet).
  hasMarketSettings: boolean;
}

export interface OutOfScopeAdSpend {
  country: string; // nom brut tel que renvoyé par meta_ads_by_country
  spendUsd: number;
}

export interface ProfitabilityData {
  mediaBuying: MediaBuyingCountryRow[];
  outOfScopeAdSpend: OutOfScopeAdSpend[];
  affiliatePayoutError: string | null;
}

// Agrège TOUS les réseaux logistiques par pays (nom résolu par chaque provider, canonique ou
// non — voir lib/providerKpi.ts/resolveCountry) — réutilisé par /profitability (marge par pays)
// et /ceo (cash encaissé), pour ne pas dupliquer cette logique entre les deux écrans. Porte
// aussi la devise brute rapportée par le réseau (2026-08-04) : nécessaire pour afficher les pays
// sans market_settings (ex. Cameroun, Argentine) sans deviner une devise.
export async function aggregateCodNetworksByCountry(
  dateFrom: string,
  dateTo: string
): Promise<Map<string, { livres: number; caLivre: number; currency: string }>> {
  const providerRowsByNetwork = await Promise.all(
    Object.keys(PROVIDERS).map((id) => PROVIDERS[id as keyof typeof PROVIDERS].fetchRows(dateFrom, dateTo))
  );

  const aggregated = new Map<string, { livres: number; caLivre: number; currency: string }>();
  for (const rows of providerRowsByNetwork) {
    for (const row of rows) {
      const entry = aggregated.get(row.countryName) ?? { livres: 0, caLivre: 0, currency: row.currency };
      entry.livres += row.livres;
      entry.caLivre += row.caLivre;
      if (!entry.currency && row.currency) entry.currency = row.currency;
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

// CRM Voralis (by_country) — payout affilié en USD, converti en devise locale via fx_to_usd par
// l'appelant (même principe que lib/treasury.ts, dupliqué ici plutôt qu'importé pour éviter un
// cycle profitability.ts <-> treasury.ts, treasury.ts important déjà depuis ce fichier). "by_country"
// est un bloc GLOBAL tous affiliés confondus par pays (pas un croisement affilié × pays) — total_payout
// est TOUJOURS en USD (confirmé par l'équipe CRM Voralis, jamais à reconvertir).
async function fetchAffiliatePayoutUsdByCountry(
  dateFrom: string,
  dateTo: string
): Promise<{ byCountry: Map<string, number>; error: string | null }> {
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
    return { byCountry, error: err instanceof Error ? err.message : "Impossible de contacter le CRM Voralis." };
  }
}

export async function fetchProfitabilityData(dateFrom: string, dateTo: string): Promise<ProfitabilityData> {
  const [aggregated, marketSettingsList, metaAdsRows, affiliatePayout, quantitySentByCountry] = await Promise.all([
    aggregateCodNetworksByCountry(dateFrom, dateTo),
    fetchMarketSettings(),
    fetchMetaAdsByCountry(dateFrom, dateTo),
    fetchAffiliatePayoutUsdByCountry(dateFrom, dateTo),
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

  // Devises déjà connues via market_settings, pour rattacher un pays SANS market_settings à un
  // taux fiable quand sa devise est une vraie devise pégée partagée (ex. Cameroun/XAF = même
  // devise réelle que Gabon/Congo, pas une approximation).
  const fxToUsdByCurrency = new Map<string, number>();
  for (const s of marketSettingsList) if (!fxToUsdByCurrency.has(s.devise_locale)) fxToUsdByCurrency.set(s.devise_locale, s.fx_to_usd);

  // ⚠️ Allowlist explicite par PAYS, pas par devise (2026-08-04) : matcher uniquement sur la
  // chaîne de devise brute serait dangereux — ex. ShipLead rapporte "Argentine" en XOF, qui
  // matcherait le XOF déjà configuré (Mali/Sénégal/Côte d'Ivoire/Burkina Faso) alors que
  // l'Argentine n'utilise PAS le franc CFA en réalité (source ShipLead visiblement mal
  // configurée pour ce marché). Seuls les pays ci-dessous ont été vérifiés comme partageant une
  // vraie devise réelle avec un pays déjà en market_settings.
  const SHARED_CURRENCY_COUNTRIES: Record<string, string> = {
    Cameroun: "XAF", // CEMAC — même devise réelle que Gabon/Congo, déjà configurés.
  };

  const mediaBuying: MediaBuyingCountryRow[] = [];
  for (const [countryName, { livres: networkLivres, caLivre: networkCaLivre, currency: rawCurrency }] of aggregated) {
    const settings = marketSettingsByPays.get(countryName);
    const payoutAffiliesUsd = affiliatePayout.byCountry.get(countryName) ?? 0;

    if (!settings) {
      // Pays servi par un réseau logistique mais sans configuration marché (2026-08-04, ex.
      // Cameroun/Argentine via ShipLead) — affiché quand même (demande CEO explicite), avec
      // marge non calculable (pas de delivery_model/COGS/ad spend configurés pour ce pays).
      // Taux USD : "USD" est toujours fiable (montant déjà en dollars) ; sinon uniquement via
      // l'allowlist ci-dessus — jamais un match par simple égalité de code devise brut.
      const sharedCurrency = SHARED_CURRENCY_COUNTRIES[countryName];
      const fxToUsd =
        rawCurrency === "USD" ? 1 : sharedCurrency ? fxToUsdByCurrency.get(sharedCurrency) ?? null : null;
      mediaBuying.push({
        countryName,
        currency: rawCurrency || "?",
        livres: networkLivres,
        caLivre: networkCaLivre,
        adSpendLocal: 0,
        adSpendKnown: false,
        payoutAffiliesLocal: 0,
        margin: {
          fraisLivraisonTotal: null,
          chargesExternesTotal: null,
          revenuNetLivraison: null,
          cogsTotal: null,
          missingFields: ["configuration marché (pays pas encore ajouté à market_settings)"],
          coutSpecifique: null,
          margeNette: null,
          ppdo: null,
        },
        fxToUsd,
        hasMarketSettings: false,
      });
      continue;
    }

    const adSpendUsd = adSpendByCanonicalCountry.get(countryName) ?? 0;
    const adSpendKnown = adSpendByCanonicalCountry.has(countryName);
    const adSpendLocal = adSpendUsd * settings.fx_to_usd;
    const payoutAffiliesLocal = payoutAffiliesUsd * settings.fx_to_usd;

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
    // coutSpecifique = ad spend + payout affiliés (2026-08-05) : les deux coûts d'acquisition
    // combinés, puisque livres/caLivre couvrent désormais TOUTES les commandes du réseau, qu'elles
    // viennent de media buying interne ou d'affiliés externes — voir avertissement en tête de fichier.
    const margin = finalizeMargin(base, livres, adSpendLocal + payoutAffiliesLocal, "ad spend + payout affiliés");

    mediaBuying.push({
      countryName,
      currency: settings.devise_locale,
      livres,
      caLivre,
      adSpendLocal,
      adSpendKnown,
      payoutAffiliesLocal,
      margin,
      fxToUsd: settings.fx_to_usd,
      hasMarketSettings: true,
    });
  }

  return {
    mediaBuying: mediaBuying.sort((a, b) => b.caLivre - a.caLivre),
    outOfScopeAdSpend,
    affiliatePayoutError: affiliatePayout.error,
  };
}
