import type { MarketSettings } from "@/lib/marketSettings";

// Moteur de marge partagé par /profitability (blocs Affiliés + Media Buying Interne), /thresholds
// et le Copilot IA. Base commune :
//   revenu_net_livraison  = CA livré encaissé − frais_livraison_total (− charges externes)
// Puis on soustrait le COGS — peut être `null` si la donnée n'a pas encore été résolue par
// l'appelant, auquel cas la marge finale est `null` et `missingFields` liste ce qui manque
// (jamais un calcul silencieux avec 0).
//
// Coût call center (2026-07-06) : confirmé par le CEO comme DÉJÀ INCLUS dans les 11 USD/commande
// de frais de livraison fixe (pays à prestataire externe) — il ne se soustrait donc plus
// séparément (ça double-compterait le même coût).
//
// Modèle de coût par pays (2026-07-08, cf. lib/fieldCash.ts) : `fraisLivraisonTotal` et
// `chargesExternesTotal` sont résolus par l'APPELANT (via resolveFraisLivraison), pas calculés
// ici — ce fichier ne connaît plus deliveryFeeLocal() ni le modèle Field Cash Angola, il reste un
// pur moteur d'arithmétique de marge, peu importe la source des frais de livraison.
// `fraisLivraisonTotal == null` signifie "configuration de coût manquante" (Angola sans
// field_delivery_params) — jamais traité comme 0.
//
// COGS (2026-07-14, demande CEO) : ne se saisit plus manuellement dans market_settings — vient
// désormais de la MÊME formule que "Cash Out par pays" en Trésorerie (lib/treasury.ts) :
// (COGS_PRODUCTION_UNIT_USD + COGS_SHIPPING_UNIT_USD) × quantité de produit expédiée sur la
// période (tous produits confondus par pays, cf. fetchQuantitySentByCountry). Résolu par
// l'appelant et passé à computeBaseMargin, comme fraisLivraisonTotal — jamais recalculé ici à
// partir de market_settings.cogs_produit (colonne retirée du moteur de marge, plus lue).
//
// Retours (2026-07-14, demande CEO) : retirés de la formule. La colonne market_settings.
// taux_retour/frais_retour_local existe toujours en base (non supprimée) mais n'est plus lue par
// aucun calcul de marge — plus de coût des retours déduit de margeNette.
export const COGS_PRODUCTION_UNIT_USD = 7;
export const COGS_SHIPPING_UNIT_USD = 8;

export interface BaseMargin {
  fraisLivraisonTotal: number | null;
  chargesExternesTotal: number | null; // uniquement Angola (internal_real_cost) — null ailleurs, pas "manquant"
  revenuNetLivraison: number | null;
  cogsTotal: number | null;
  missingFields: string[];
}

export interface MarginBreakdown extends BaseMargin {
  coutSpecifique: number | null;
  margeNette: number | null;
  ppdo: number | null; // marge nette ÷ livrées
}

// L = leads nécessaires pour obtenir une livrée = 1 / (conf% × DR%). Valeurs de RÉFÉRENCE
// saisies par le CEO dans market_settings (conf_pct/dr_pct), pas le taux observé de la période
// — doit rester cohérent avec le futur module "Seuils" qui utilise le même L.
export function computeL(confPct: number | null, drPct: number | null): number | null {
  if (confPct == null || drPct == null || confPct === 0 || drPct === 0) return null;
  return 1 / ((confPct / 100) * (drPct / 100));
}

export function computeBaseMargin(
  caLivre: number,
  settings: MarketSettings,
  fraisLivraisonTotal: number | null,
  chargesExternesTotal: number | null,
  cogsTotal: number | null
): BaseMargin {
  const missingFields: string[] = [];

  if (fraisLivraisonTotal == null) {
    missingFields.push("frais de livraison (configuration Field Cash Angola incomplète)");
  }
  const revenuNetLivraison = fraisLivraisonTotal != null ? caLivre - fraisLivraisonTotal : null;

  // cogsTotal résolu par l'appelant (quantité expédiée × 15$, voir lib/treasury.ts /
  // fetchQuantitySentByCountry) — 0 si aucune expédition sur la période, jamais null en
  // pratique, gardé nullable pour rester cohérent avec fraisLivraisonTotal.
  if (cogsTotal == null) {
    missingFields.push("COGS (quantité expédiée)");
  }

  return { fraisLivraisonTotal, chargesExternesTotal, revenuNetLivraison, cogsTotal, missingFields };
}

// coutSpecifique = payout_affilié (bloc Affiliés) ou ad_spend converti en devise locale (bloc
// Media Buying Interne) — calculé par l'appelant car sa source diffère selon le bloc.
export function finalizeMargin(
  base: BaseMargin,
  livres: number,
  coutSpecifique: number | null,
  coutSpecifiqueLabel: string
): MarginBreakdown {
  const missingFields = coutSpecifique == null ? [...base.missingFields, coutSpecifiqueLabel] : base.missingFields;

  const allKnown = base.revenuNetLivraison != null && base.cogsTotal != null && coutSpecifique != null;

  const margeNette = allKnown
    ? base.revenuNetLivraison! - coutSpecifique! - base.cogsTotal! - (base.chargesExternesTotal ?? 0)
    : null;

  const ppdo = margeNette != null && livres > 0 ? margeNette / livres : null;

  return { ...base, missingFields, coutSpecifique, margeNette, ppdo };
}