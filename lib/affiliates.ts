import { getCanonicalCountry, flagFromIsoAlpha2 } from "@/lib/countries";
import { aggregateCodNetworksByCountry } from "@/lib/profitability";
import { fetchMarketSettings, type MarketSettings } from "@/lib/marketSettings";

// CRM Voralis (/api/v1/reports/networks) — vérifié en direct le 2026-07-04 :
//   - "by_country" est un bloc GLOBAL (tous affiliés confondus), pas un croisement
//     affilié × pays. Deux vues séparées seulement : par affilié, et par pays.
//   - Les codes pays ne sont pas normalisés uniformément (AGO en alpha-3, mais
//     CI/MA/GN/SN/... en alpha-2) — lib/countries.ts accepte les deux formats en alias.
//   - Le payout est TOUJOURS en USD, jamais à convertir (confirmé par l'équipe CRM Voralis,
//     champ payout_amount, convention fixe dans toute leur appli).
//
// Règle métier confirmée par le CEO (2026-07-05) : le payout affilié est payé sur la commande
// CONFIRMÉE, pas livrée — EXCEPTION valable uniquement pour ce calcul de coût unitaire du
// payout (ne remet pas en cause la règle générale "l'argent n'existe que sur livré+encaissé"
// pour le CA/la marge, qui reste inchangée partout ailleurs). Le coût payout par unité se
// ramène donc à payout total ÷ commandes CONFIRMÉES, jamais ÷ livrées.
//
// CA par affilié (2026-08-04) : jusqu'ici impossible ("rentabilité nette" toujours affichée
// "incomplète"), résolu par le nouvel endpoint CRM /api/v1/reports/orders (commandes
// individuelles, avec product_price/total_price réels). Deux pièges vérifiés en direct sur ce
// nouvel endpoint :
//   - Le champ `currency` renvoyé est systématiquement "USD" (confirmé par l'équipe CRM : bug de
//     sérialisation, le prix EST en devise locale réelle mais l'étiquette qui l'accompagne ne
//     l'est pas) — on l'ignore complètement et on déduit la devise du `country` de la commande,
//     comme partout ailleurs dans ce dashboard (lib/countries.ts).
//   - `sub_affiliate` (commandes) correspond exactement à `affiliates[].name` (réseaux) — vérifié
//     en direct sur Ezaff/Lemonad/DS — mais ce code peut se répéter d'un réseau à l'autre, donc la
//     clé de jointure est TOUJOURS la paire (affiliate_name, sub_affiliate), jamais sub_affiliate seul.

interface RawStats {
  total_orders: number;
  confirmed_orders: number;
  delivered_orders: number;
  total_payout: number;
}

interface CrmOrderRow {
  order_id: string;
  affiliate_name: string;
  sub_affiliate: string;
  country: string;
  total_price: number | null;
  status: string;
  delivered_at: string | null;
}

// Politique CEO (2026-08-04) : un nouveau pays avec un vrai volume de commandes doit être pris
// en compte immédiatement, jamais bloqué en attendant une validation manuelle. Pour le nom/
// drapeau, repli sur le code ISO (même principe que lib/providerKpi.ts, resolveCountry). Pour la
// devise → USD, repli sur le taux DÉJÀ connu pour cette DEVISE (pas ce pays) dans market_settings
// — un nouveau pays qui partage une devise déjà suivie (ex. Centrafrique/XAF, déjà utilisée par
// Cameroun/Congo/Gabon) se convertit donc automatiquement, sans configuration dédiée. Seule une
// devise totalement inédite reste non convertie (montant affiché en devise locale uniquement).
const isoRegionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["fr"], { type: "region" }) : null;
function nameFromIsoAlpha2(code: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code) || !isoRegionNames) return null;
  try {
    return isoRegionNames.of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

function buildFxByCurrency(marketSettingsList: MarketSettings[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of marketSettingsList) {
    if (!map.has(s.devise_locale)) map.set(s.devise_locale, s.fx_to_usd);
  }
  return map;
}

async function fetchCrmOrders(status: string): Promise<CrmOrderRow[]> {
  const res = await fetch(`/api/orders?status=${status}`);
  // /api/orders peut répondre par une page d'erreur non-JSON en cas de crash serveur — .json()
  // planterait alors avec "Unexpected token <"/"unexpected character…", opaque pour l'utilisateur.
  const text = await res.text();
  let json: { success?: boolean; message?: string; orders?: unknown[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Réponse invalide de /api/orders (HTTP ${res.status}) — voir les logs serveur.`);
  }
  if (!json.success) throw new Error(json.message ?? "Erreur CRM Voralis (commandes)");
  return (json.orders ?? []) as CrmOrderRow[];
}

// CA livré par (réseau, code affilié) : le total en USD est la valeur de référence (colonne
// "Rentabilité nette (USD)"), calculé commande par commande (chaque commande convertie avec le
// taux de SA propre devise) — jamais en sommant des montants de devises différentes entre eux.
// Un affilié peut vendre dans plusieurs pays (vérifié en direct : 13/39 affiliés actuels sont
// multi-pays) donc "local"/"currency" ne sont renseignés QUE si l'affilié n'a livré que dans une
// seule devise sur la période (sinon null — le total USD reste la seule vue fiable). Si UNE SEULE
// commande a une devise sans taux connu nulle part dans market_settings, tout le total USD de cet
// affilié repasse à null plutôt que d'afficher un total silencieusement sous-évalué.
// Filtré sur delivered_at tombant dans la période (pas created_at) — même règle "l'argent
// n'existe que sur livré+encaissé" que partout ailleurs — plutôt que de faire confiance à un
// filtre from/to côté API dont on ne connaît pas le champ de référence exact.
function aggregateDeliveredCaByAffiliate(
  orders: CrmOrderRow[],
  dateFrom: string,
  dateTo: string,
  fxByCurrency: Map<string, number>
): Map<string, { usd: number | null; currency: string | null; local: number | null }> {
  const byKey = new Map<
    string,
    { usd: number; currencies: Set<string>; incompleteFx: boolean; localByCurrency: Map<string, number> }
  >();

  for (const o of orders) {
    if (o.status !== "delivered" || !o.delivered_at || o.total_price == null) continue;
    const deliveredDate = o.delivered_at.slice(0, 10);
    if (deliveredDate < dateFrom || deliveredDate > dateTo) continue;

    const canonical = getCanonicalCountry(o.country);
    const currency = canonical?.currency;
    if (!currency) continue; // pays totalement inconnu (ni canonique ni ISO alpha-2 exploitable) — cas extrême

    const key = `${o.affiliate_name}::${o.sub_affiliate}`;
    const entry = byKey.get(key) ?? { usd: 0, currencies: new Set<string>(), incompleteFx: false, localByCurrency: new Map<string, number>() };
    entry.currencies.add(currency);
    entry.localByCurrency.set(currency, (entry.localByCurrency.get(currency) ?? 0) + o.total_price);

    const fx = fxByCurrency.get(currency);
    if (fx != null) entry.usd += o.total_price / fx;
    else entry.incompleteFx = true;

    byKey.set(key, entry);
  }

  const result = new Map<string, { usd: number | null; currency: string | null; local: number | null }>();
  for (const [key, entry] of byKey) {
    const singleCurrency = entry.currencies.size === 1 ? [...entry.currencies][0] : null;
    result.set(key, {
      usd: entry.incompleteFx ? null : entry.usd,
      currency: singleCurrency,
      local: singleCurrency ? entry.localByCurrency.get(singleCurrency)! : null,
    });
  }
  return result;
}

export interface AffiliateRow {
  id: string;
  name: string;
  networkName: string;
  totalOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;
  drPct: number | null; // delivered/confirmed — null si confirmedOrders = 0 (non calculable, pas "manquant")
  totalPayoutUsd: number;
  payoutPerConfirmedUsd: number | null; // null si confirmedOrders = 0 — payé à la confirmation, pas à la livraison
  // CA livré (2026-08-04) : désormais calculable grâce à /api/v1/reports/orders (commandes
  // individuelles, avec prix produit réel) — voir fetchCrmOrders/aggregateDeliveredCaByAffiliate
  // ci-dessous. caLivreUsd = référence (colonne "Rentabilité nette (USD)") ; null uniquement si
  // l'affilié n'a aucune commande livrée sur la période, OU si une de ses commandes livrées est
  // dans une devise sans taux connu nulle part dans market_settings (jamais un total sous-évalué
  // en silence). caLivreLocal/caLivreCurrency ne sont renseignés QUE si l'affilié n'a livré que
  // dans un seul pays/une seule devise sur la période — sinon null (impossible d'additionner des
  // devises différentes dans un seul montant local).
  caLivreLocal: number | null;
  caLivreCurrency: string | null;
  caLivreUsd: number | null;
  margeNetteUsd: number | null; // caLivreUsd - totalPayoutUsd, null si caLivreUsd est null
}

export interface CountryAffiliateRow {
  countryCode: string; // code brut renvoyé par l'API (ex. "AGO", "CI")
  countryName: string | null; // nom canonique, ou nom ISO en repli pour un pays pas encore ajouté — null seulement si le code ISO lui-même est inexploitable
  flag: string;
  totalOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;
  drPct: number | null;
  totalPayoutUsd: number;
  payoutPerConfirmedUsd: number | null;
  // CA livré encaissé / marge nette (2026-08-04) : demande CEO, avec une limite connue — le CRM
  // Voralis n'expose pas le CA livré par affilié/pays, et les tables des réseaux logistiques
  // (ClickMarket/Coliscod/Africod Congo/Shipsen/...) ne distinguent pas les commandes par canal
  // (affilié vs Media Buying interne). Décision CEO (2026-08-04) : afficher le CA livré du PAYS
  // ENTIER, tous canaux confondus (même agrégation que /profitability, aggregateCodNetworksByCountry)
  // — PAS un CA spécifique aux affiliés. Marge nette = ce CA livré (devise locale) − payout total
  // affiliés du pays (converti de USD en devise locale via fx_to_usd). null si le pays est hors
  // périmètre COD (pas de market_settings, ex. Maroc/France) — jamais un 0 fabriqué.
  caLivrePays: number | null;
  currency: string | null;
  margeNettePays: number | null;
}

export interface AffiliatesData {
  affiliates: AffiliateRow[];
  byCountry: CountryAffiliateRow[];
  totals: { networks: number; affiliates: number; confirmedOrders: number };
  generatedAt: string;
}

function computeDrPct(stats: RawStats): number | null {
  if (stats.confirmed_orders <= 0) return null;
  return Math.round((stats.delivered_orders / stats.confirmed_orders) * 1000) / 10;
}

// Payout ÷ commandes CONFIRMÉES (pas livrées) — le payout est dû dès la confirmation dans ce
// business, cf. note en tête de fichier.
function computePayoutPerConfirmed(stats: RawStats): number | null {
  if (stats.confirmed_orders <= 0) return null;
  return stats.total_payout / stats.confirmed_orders;
}

export async function fetchAffiliatesData(dateFrom: string, dateTo: string): Promise<AffiliatesData> {
  const [res, codNetworksByCountry, marketSettingsList, deliveredOrders] = await Promise.all([
    fetch(`/api/networks?dateFrom=${dateFrom}&dateTo=${dateTo}`),
    aggregateCodNetworksByCountry(dateFrom, dateTo),
    fetchMarketSettings(),
    fetchCrmOrders("delivered"),
  ]);
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "Erreur CRM Voralis");

  const marketSettingsByPays = new Map<string, MarketSettings>(marketSettingsList.map((s) => [s.pays, s]));
  const fxByCurrency = buildFxByCurrency(marketSettingsList);
  const caByAffiliate = aggregateDeliveredCaByAffiliate(deliveredOrders, dateFrom, dateTo, fxByCurrency);

  const affiliates: AffiliateRow[] = [];
  for (const network of json.networks ?? []) {
    for (const aff of network.affiliates ?? []) {
      const s: RawStats = aff.stats;
      const ca = caByAffiliate.get(`${network.name}::${aff.name}`) ?? null;
      affiliates.push({
        id: aff.id,
        name: aff.name,
        networkName: network.name,
        totalOrders: s.total_orders,
        confirmedOrders: s.confirmed_orders,
        deliveredOrders: s.delivered_orders,
        drPct: computeDrPct(s),
        totalPayoutUsd: s.total_payout,
        payoutPerConfirmedUsd: computePayoutPerConfirmed(s),
        caLivreLocal: ca?.local ?? null,
        caLivreCurrency: ca?.currency ?? null,
        caLivreUsd: ca?.usd ?? null,
        margeNetteUsd: ca?.usd != null ? ca.usd - s.total_payout : null,
      });
    }
  }

  const byCountry: CountryAffiliateRow[] = (json.by_country ?? []).map((row: { country: string; stats: RawStats }) => {
    const canonical = getCanonicalCountry(row.country);
    const settings = canonical ? marketSettingsByPays.get(canonical.name) : undefined;
    const caLivrePays = settings ? codNetworksByCountry.get(canonical!.name)?.caLivre ?? 0 : null;
    const margeNettePays = caLivrePays != null && settings ? caLivrePays - row.stats.total_payout * settings.fx_to_usd : null;

    return {
      countryCode: row.country,
      // Repli sur le nom ISO (ex. "CD" -> "RD Congo") plutôt que null dès qu'un nouveau pays
      // apparaît hors périmètre COD — jamais bloqué en attendant un ajout à CANONICAL_COUNTRIES.
      countryName: canonical?.name ?? nameFromIsoAlpha2(row.country) ?? null,
      flag: canonical?.flag ?? flagFromIsoAlpha2(row.country) ?? "🌍",
      totalOrders: row.stats.total_orders,
      confirmedOrders: row.stats.confirmed_orders,
      deliveredOrders: row.stats.delivered_orders,
      drPct: computeDrPct(row.stats),
      totalPayoutUsd: row.stats.total_payout,
      payoutPerConfirmedUsd: computePayoutPerConfirmed(row.stats),
      caLivrePays,
      currency: settings?.devise_locale ?? null,
      margeNettePays,
    };
  });

  return {
    affiliates,
    byCountry,
    totals: {
      networks: json.totals?.networks ?? 0,
      affiliates: json.totals?.affiliates ?? 0,
      confirmedOrders: json.totals?.confirmed_orders ?? 0,
    },
    generatedAt: json.generated_at,
  };
}
