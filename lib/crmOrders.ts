import { getCanonicalCountry } from "@/lib/countries";
import type { MarketSettings } from "@/lib/marketSettings";

// Module partagé pour les commandes individuelles CRM Voralis (/api/v1/reports/orders, ajouté
// 2026-08-04) — extrait de lib/affiliates.ts le 2026-08-05 pour être réutilisable aussi par
// lib/profitability.ts (Media Buying Interne), sans dépendance circulaire (affiliates.ts importe
// déjà aggregateCodNetworksByCountry depuis profitability.ts).
//
// Fait métier confirmé par le CEO (2026-08-05) : les commandes livrées par les réseaux
// logistiques (ClickMarket/Coliscod/Africod Congo/Shipsen/ShipLead/MLShipAfrica/Ikatchiexpress)
// ne viennent PAS uniquement de Media Buying Interne (Meta Ads) — une partie vient d'affiliés
// externes, et c'est LA MÊME commande qui apparaît à la fois dans la table du réseau logistique
// ET dans le CRM Voralis. aggregateDeliveredCaByCountry() ci-dessous donne donc la part
// affiliée à retirer du total réseau pour ne pas la compter deux fois (voir lib/profitability.ts).
//
// Deux pièges vérifiés en direct sur /api/v1/reports/orders :
//   - Le champ `currency` renvoyé est systématiquement "USD" (bug de sérialisation confirmé par
//     l'équipe CRM : le prix EST en devise locale réelle mais l'étiquette qui l'accompagne ne
//     l'est pas) — on l'ignore et on déduit la devise du `country` de la commande.
//   - `sub_affiliate` (commandes) correspond exactement à `affiliates[].name` (réseaux) mais ce
//     code peut se répéter d'un réseau à l'autre — clé de jointure TOUJOURS (affiliate_name,
//     sub_affiliate), jamais sub_affiliate seul (non pertinent pour l'agrégation par pays ici,
//     mais garde le même avertissement que lib/affiliates.ts pour toute réutilisation future).

export interface CrmOrderRow {
  order_id: string;
  affiliate_name: string;
  sub_affiliate: string;
  country: string;
  total_price: number | null;
  status: string;
  delivered_at: string | null;
}

export async function fetchCrmOrders(status: string): Promise<CrmOrderRow[]> {
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

export function buildFxByCurrency(marketSettingsList: MarketSettings[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of marketSettingsList) {
    if (!map.has(s.devise_locale)) map.set(s.devise_locale, s.fx_to_usd);
  }
  return map;
}

// CA livré par (réseau, code affilié) : le total en USD est la valeur de référence, calculé
// commande par commande (chaque commande convertie avec le taux de SA propre devise) — jamais en
// sommant des montants de devises différentes entre eux. Un affilié peut vendre dans plusieurs
// pays donc "local"/"currency" ne sont renseignés QUE si l'affilié n'a livré que dans une seule
// devise sur la période (sinon null). Si UNE SEULE commande a une devise sans taux connu nulle
// part dans market_settings, tout le total USD de cet affilié repasse à null plutôt que d'afficher
// un total silencieusement sous-évalué. Filtré sur delivered_at tombant dans la période (pas
// created_at) — même règle "l'argent n'existe que sur livré+encaissé" que partout ailleurs.
export function aggregateDeliveredCaByAffiliate(
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

// CA livré + nombre de livrées PAR PAYS, spécifiquement pour les commandes affiliées (CRM
// Voralis) — voir le commentaire en tête de fichier : c'est la part à soustraire du total réseau
// logistique (aggregateCodNetworksByCountry) pour isoler ce qui revient vraiment à Media Buying
// Interne. total_price est déjà en devise locale réelle du pays (malgré le champ `currency`
// toujours "USD", voir avertissement en tête de fichier) — pas de conversion nécessaire ici, la
// somme est directement comparable à networkCaLivre d'un même pays (même devise).
export function aggregateDeliveredCaByCountry(
  orders: CrmOrderRow[],
  dateFrom: string,
  dateTo: string
): Map<string, { livres: number; caLivreLocal: number }> {
  const byCountry = new Map<string, { livres: number; caLivreLocal: number }>();

  for (const o of orders) {
    if (o.status !== "delivered" || !o.delivered_at || o.total_price == null) continue;
    const deliveredDate = o.delivered_at.slice(0, 10);
    if (deliveredDate < dateFrom || deliveredDate > dateTo) continue;

    const canonical = getCanonicalCountry(o.country);
    if (!canonical) continue;

    const entry = byCountry.get(canonical.name) ?? { livres: 0, caLivreLocal: 0 };
    entry.livres += 1;
    entry.caLivreLocal += o.total_price;
    byCountry.set(canonical.name, entry);
  }

  return byCountry;
}
