import type { MarketSettings } from "@/lib/marketSettings";

// Moteur de marge partagé par /profitability (blocs Affiliés + Media Buying Interne), /thresholds
// et le Copilot IA. Base commune :
//   revenu_net_livraison  = CA livré encaissé − frais_livraison_total (− charges externes)
// Puis on soustrait COGS et retours — chacun peut être `null` si la donnée n'a pas encore été
// saisie par le CEO, auquel cas la marge finale est `null` et `missingFields` liste ce qui
// manque (jamais un calcul silencieux avec 0).
//
// Coût call center (2026-07-06) : confirmé par le CEO comme DÉJÀ INCLUS dans les 11 USD/commande
// de frais de livraison fixe (pays à prestataire externe) — il ne se soustrait donc plus
// séparément (ça double-compterait le même coût).
//
// Modèle de coût par pays (2026-07-08, cf. lib/fieldCash.ts) : `fraisLivraisonTotal` et
// `chargesExternesTotal` sont désormais résolus par l'APPELANT (via resolveFraisLivraison), pas
// calculés ici — ce fichier ne connaît plus deliveryFeeLocal() ni le modèle Field Cash Angola,
// il reste un pur moteur d'arithmétique de marge, peu importe la source des frais de livraison.
// `fraisLivraisonTotal == null` signifie "configuration de coût manquante" (Angola sans
// field_delivery_params) — jamais traité comme 0.

export interface BaseMargin {
  fraisLivraisonTotal: number | null;
  chargesExternesTotal: number | null; // uniquement Angola (internal_real_cost) — null ailleurs, pas "manquant"
  revenuNetLivraison: number | null;
  cogsTotal: number | null;
  coutRetoursTotal: number | null;
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
  livres: number,
  caLivre: number,
  settings: MarketSettings,
  fraisLivraisonTotal: number | null,
  chargesExternesTotal: number | null
): BaseMargin {
  const missingFields: string[] = [];

  if (fraisLivraisonTotal == null) {
    missingFields.push("frais de livraison (configuration Field Cash Angola incomplète)");
  }
  const revenuNetLivraison = fraisLivraisonTotal != null ? caLivre - fraisLivraisonTotal : null;

  // COGS — un produit retourné est réintégrable au stock (revendable), donc le COGS ne se
  // soustrait qu'une fois, sur les livrées, jamais une seconde fois dans le coût des retours.
  let cogsTotal: number | null = null;
  if (settings.cogs_produit == null) {
    missingFields.push("COGS produit");
  } else {
    const cogsLocal = settings.cogs_devise === "USD" ? settings.cogs_produit * settings.fx_to_usd : settings.cogs_produit;
    cogsTotal = livres * cogsLocal;
  }

  // Retours : coût = transport aller déjà engagé (frais de livraison, non récupérable) + frais
  // de retour éventuel du réseau (0 tant que non précisé) — jamais le COGS (produit récupéré).
  // Pour l'Angola (internal_real_cost), fraisLivraisonTotal est un TOTAL période (pas un taux
  // unitaire) : on retombe sur le taux moyen par livrée pour rester cohérent avec la formule.
  let coutRetoursTotal: number | null = null;
  if (settings.taux_retour == null) {
    missingFields.push("taux de retour");
  } else if (fraisLivraisonTotal != null) {
    const fraisLivraisonLocal = livres > 0 ? fraisLivraisonTotal / livres : 0;
    const fraisRetourLocal = settings.frais_retour_local ?? 0;
    coutRetoursTotal = livres * (settings.taux_retour / 100) * (fraisLivraisonLocal + fraisRetourLocal);
  }

  return { fraisLivraisonTotal, chargesExternesTotal, revenuNetLivraison, cogsTotal, coutRetoursTotal, missingFields };
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

  const allKnown =
    base.revenuNetLivraison != null && base.cogsTotal != null && base.coutRetoursTotal != null && coutSpecifique != null;

  const margeNette = allKnown
    ? base.revenuNetLivraison! - coutSpecifique! - base.cogsTotal! - base.coutRetoursTotal! - (base.chargesExternesTotal ?? 0)
    : null;

  const ppdo = margeNette != null && livres > 0 ? margeNette / livres : null;

  return { ...base, missingFields, coutSpecifique, margeNette, ppdo };
}