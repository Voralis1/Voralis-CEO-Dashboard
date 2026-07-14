import { deliveryFeeLocal } from "@/lib/marketSettings";

// Client-safe : types + fetch (relative URLs) + résolution PURE (aucun import supabaseAdmin ici,
// pour rester importable depuis un composant "use client"). L'agrégation réelle (supabaseAdmin)
// vit dans lib/fieldCashServer.ts, utilisée uniquement par les routes API et les agrégateurs
// 100% serveur (lib/thresholds.ts, lib/copilot/snapshot.ts) — même séparation client/serveur
// déjà en place entre lib/profitability.ts (client) et lib/thresholds.ts (serveur).

// Angola opère sa propre logistique interne (mini-app "Field Cash Angola") depuis le 2026-07-08.
// fraisLivraisonInterneTotal = somme de field_deliveries.delivery_fee sur la période (2026-07-13 —
// valeur réelle saisie par livraison, plus de reconstitution par taux commission/carburant).
export interface FieldCashRecap {
  country: string;
  currency: string | null; // null si field_delivery_params absent pour ce pays
  nbDeliveries: number;
  totalEncaisse: number;
  fraisLivraisonInterneTotal: number;
  chargesExternesTotal: number;
  // Commission agent (2026-07-14, demande CEO) : nb livraisons × 2000 (devise locale), extraite
  // du montant restant plutôt qu'ajoutée comme coût séparé — cashDetenuRestant est net de cette
  // commission (elle appartient à l'agent, pas à la trésorerie de l'entreprise). N'affecte PAS
  // fraisLivraisonInterneTotal/resolveFraisLivraison (le calcul de marge reste inchangé) : c'est
  // une reclassification d'affichage du cash détenu, pas un nouveau coût dans le moteur de marge.
  commissionAgentTotal: number;
  remisTotal: number; // status = 'received' uniquement
  remisEnTransit: number; // status = 'pending' ou 'sent' — informatif, pas encore déduit
  cashDetenuRestant: number;
  missingParams: boolean;
}

export interface FieldCashAgentRow {
  agent: string;
  nbDeliveries: number;
  totalEncaisse: number;
}

export async function fetchFieldCashRecap(country: string, dateFrom: string, dateTo: string): Promise<FieldCashRecap> {
  const res = await fetch(`/api/field-cash?country=${encodeURIComponent(country)}&dateFrom=${dateFrom}&dateTo=${dateTo}`);
  if (!res.ok) throw new Error(`Échec du chargement Field Cash (${res.status})`);
  const json = await res.json();
  return json.recap as FieldCashRecap;
}

export async function fetchFieldCashByAgent(country: string, dateFrom: string, dateTo: string): Promise<FieldCashAgentRow[]> {
  const res = await fetch(`/api/field-cash/agents?country=${encodeURIComponent(country)}&dateFrom=${dateFrom}&dateTo=${dateTo}`);
  if (!res.ok) throw new Error(`Échec du chargement des agents Field Cash (${res.status})`);
  const json = await res.json();
  return json.agents as FieldCashAgentRow[];
}

interface DeliveryModelSettings {
  fx_to_usd: number;
  delivery_model: string;
}

// Frais de livraison TOTAL pour un pays/période — unique point d'entrée pour margin.ts/
// treasury.ts : external_11usd (6 pays) = comportement inchangé (deliveryFeeLocal × livrées) ;
// internal_real_cost (Angola) = SOMME de deux canaux distincts (2026-07-14, demande CEO) :
// Coliscod (réseau externe présent en Angola, forfait 11$/livraison comme les 6 autres pays,
// `livres` ici = son propre compteur, PAS combiné avec Field Cash) + Field Cash (flotte interne,
// coût réel de sa propre livraison). Avant ce changement, seul le coût Field Cash était compté,
// ignorant silencieusement le volume Coliscod — historiquement voulu pour ne pas mélanger deux
// compteurs qui peuvent diverger, mais le CEO a confirmé que les deux canaux sont réels et
// doivent s'additionner plutôt que l'un écraser l'autre. Voir aussi combineLivresCaLivre()
// ci-dessous, à utiliser en parallèle pour combiner les REVENUS (livres/caLivre affichés).
export function resolveFraisLivraison(
  settings: DeliveryModelSettings,
  livres: number,
  recap: FieldCashRecap | null
): { fraisLivraisonTotal: number | null; chargesExternesTotal: number | null } {
  if (settings.delivery_model !== "internal_real_cost") {
    return { fraisLivraisonTotal: livres * deliveryFeeLocal(settings.fx_to_usd), chargesExternesTotal: null };
  }
  if (!recap) return { fraisLivraisonTotal: null, chargesExternesTotal: null };
  return {
    fraisLivraisonTotal: livres * deliveryFeeLocal(settings.fx_to_usd) + recap.fraisLivraisonInterneTotal,
    chargesExternesTotal: recap.chargesExternesTotal,
  };
}

// Combine les REVENUS (livres/caLivre) de deux canaux distincts pour l'Angola — Coliscod
// (paramètre networkLivres/networkCaLivre, déjà agrégé par aggregateCodNetworksByCountry) +
// Field Cash (recap.nbDeliveries/totalEncaisse). Pour les 6 pays external_11usd, retourne les
// valeurs réseau inchangées (Field Cash n'existe pas pour eux). À utiliser AVANT
// computeBaseMargin/finalizeMargin (qui doivent voir le total combiné, comme
// resolveFraisLivraison ci-dessus) — jamais après, sous peine d'un mismatch livres/frais.
export function combineLivresCaLivre(
  settings: DeliveryModelSettings,
  networkLivres: number,
  networkCaLivre: number,
  recap: FieldCashRecap | null
): { livres: number; caLivre: number } {
  if (settings.delivery_model !== "internal_real_cost") {
    return { livres: networkLivres, caLivre: networkCaLivre };
  }
  return {
    livres: networkLivres + (recap?.nbDeliveries ?? 0),
    caLivre: networkCaLivre + (recap?.totalEncaisse ?? 0),
  };
}

// Variante PAR UNITÉ (taux moyen observé sur la période) — uniquement pour l'astuce
// computeBaseMargin(1, aov, ...) de lib/thresholds.ts. Pour l'Angola, faute d'un "coût de la
// prochaine commande" connu à l'avance, on utilise la moyenne réelle observée sur la période
// sélectionnée — même esprit que conf_pct/dr_pct de référence déjà stockés dans market_settings.
// networkLivres (2026-07-14, défaut 0 pour les appelants qui ne l'ont pas encore) : volume
// Coliscod sur la même période, pour une moyenne PONDÉRÉE entre son forfait 11$/livraison et le
// coût réel Field Cash — cohérent avec resolveFraisLivraison/combineLivresCaLivre ci-dessus, qui
// additionnent déjà les deux canaux plutôt que de ne garder que Field Cash.
export function resolveFraisLivraisonUnitaire(
  settings: DeliveryModelSettings,
  recap: FieldCashRecap | null,
  networkLivres = 0
): { fraisLivraisonUnitaire: number | null; chargesExternesUnitaire: number | null } {
  if (settings.delivery_model !== "internal_real_cost") {
    return { fraisLivraisonUnitaire: deliveryFeeLocal(settings.fx_to_usd), chargesExternesUnitaire: null };
  }
  const totalLivres = networkLivres + (recap?.nbDeliveries ?? 0);
  if (!recap || totalLivres === 0) {
    return { fraisLivraisonUnitaire: null, chargesExternesUnitaire: null };
  }
  const fraisTotal = networkLivres * deliveryFeeLocal(settings.fx_to_usd) + recap.fraisLivraisonInterneTotal;
  return {
    fraisLivraisonUnitaire: fraisTotal / totalLivres,
    chargesExternesUnitaire: recap.chargesExternesTotal / totalLivres,
  };
}