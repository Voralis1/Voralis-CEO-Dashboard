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
// internal_real_cost (Angola) = total réel Field Cash de la période, PAS une multiplication par
// un taux (évite de mélanger le compteur de livraisons Coliscod avec celui de Field Cash, qui
// peuvent diverger — ce sont deux systèmes distincts).
export function resolveFraisLivraison(
  settings: DeliveryModelSettings,
  livres: number,
  recap: FieldCashRecap | null
): { fraisLivraisonTotal: number | null; chargesExternesTotal: number | null } {
  if (settings.delivery_model !== "internal_real_cost") {
    return { fraisLivraisonTotal: livres * deliveryFeeLocal(settings.fx_to_usd), chargesExternesTotal: null };
  }
  if (!recap) return { fraisLivraisonTotal: null, chargesExternesTotal: null };
  return { fraisLivraisonTotal: recap.fraisLivraisonInterneTotal, chargesExternesTotal: recap.chargesExternesTotal };
}

// Variante PAR UNITÉ (taux moyen observé sur la période) — uniquement pour l'astuce
// computeBaseMargin(1, aov, ...) de lib/thresholds.ts. Pour l'Angola, faute d'un "coût de la
// prochaine commande" connu à l'avance, on utilise la moyenne réelle observée sur la période
// sélectionnée — même esprit que conf_pct/dr_pct de référence déjà stockés dans market_settings.
export function resolveFraisLivraisonUnitaire(
  settings: DeliveryModelSettings,
  recap: FieldCashRecap | null
): { fraisLivraisonUnitaire: number | null; chargesExternesUnitaire: number | null } {
  if (settings.delivery_model !== "internal_real_cost") {
    return { fraisLivraisonUnitaire: deliveryFeeLocal(settings.fx_to_usd), chargesExternesUnitaire: null };
  }
  if (!recap || recap.nbDeliveries === 0) {
    return { fraisLivraisonUnitaire: null, chargesExternesUnitaire: null };
  }
  return {
    fraisLivraisonUnitaire: recap.fraisLivraisonInterneTotal / recap.nbDeliveries,
    chargesExternesUnitaire: recap.chargesExternesTotal / recap.nbDeliveries,
  };
}