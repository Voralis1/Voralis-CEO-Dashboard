import { deliveryFeeLocal, type MarketSettings } from "@/lib/marketSettings";

// Moteur de marge partagé par /profitability (blocs Affiliés + Media Buying Interne) et par
// tout futur écran qui calcule une marge par pays. Base commune :
//   frais_livraison_total = nb_livrées × deliveryFeeLocal(pays)   ← même fonction que Prompt 1
//   revenu_net_livraison  = CA livré encaissé − frais_livraison_total
// Puis on soustrait COGS, call center (ramené à la livrée via L) et retours — chacun peut être
// `null` si la donnée n'a pas encore été saisie par le CEO, auquel cas la marge finale est
// `null` et `missingFields` liste ce qui manque (jamais un calcul silencieux avec 0).

export interface BaseMargin {
  fraisLivraisonTotal: number;
  revenuNetLivraison: number;
  cogsTotal: number | null;
  coutCallCenterTotal: number | null;
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

export function computeBaseMargin(livres: number, caLivre: number, settings: MarketSettings): BaseMargin {
  const fraisLivraisonLocal = deliveryFeeLocal(settings.fx_to_usd);
  const fraisLivraisonTotal = livres * fraisLivraisonLocal;
  const revenuNetLivraison = caLivre - fraisLivraisonTotal;

  const missingFields: string[] = [];

  // COGS — un produit retourné est réintégrable au stock (revendable), donc le COGS ne se
  // soustrait qu'une fois, sur les livrées, jamais une seconde fois dans le coût des retours.
  let cogsTotal: number | null = null;
  if (settings.cogs_produit == null) {
    missingFields.push("COGS produit");
  } else {
    const cogsLocal = settings.cogs_devise === "USD" ? settings.cogs_produit * settings.fx_to_usd : settings.cogs_produit;
    cogsTotal = livres * cogsLocal;
  }

  // Call center : coût engagé sur le volume ENTRANT (tous les leads), ramené à la livrée via L.
  const L = computeL(settings.conf_pct, settings.dr_pct);
  let coutCallCenterTotal: number | null = null;
  if (settings.cout_call_center_par_commande == null) {
    missingFields.push("coût call center par commande");
  } else if (L == null) {
    missingFields.push("taux de confirmation/livraison (nécessaires pour ramener le coût call center à la livrée)");
  } else {
    coutCallCenterTotal = livres * settings.cout_call_center_par_commande * L;
  }

  // Retours : coût = transport aller déjà engagé (frais de livraison, non récupérable) + frais
  // de retour éventuel du réseau (0 tant que non précisé) — jamais le COGS (produit récupéré).
  let coutRetoursTotal: number | null = null;
  if (settings.taux_retour == null) {
    missingFields.push("taux de retour");
  } else {
    const fraisRetourLocal = settings.frais_retour_local ?? 0;
    coutRetoursTotal = livres * (settings.taux_retour / 100) * (fraisLivraisonLocal + fraisRetourLocal);
  }

  return { fraisLivraisonTotal, revenuNetLivraison, cogsTotal, coutCallCenterTotal, coutRetoursTotal, missingFields };
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
    base.cogsTotal != null && base.coutCallCenterTotal != null && base.coutRetoursTotal != null && coutSpecifique != null;

  const margeNette = allKnown
    ? base.revenuNetLivraison - coutSpecifique! - base.cogsTotal! - base.coutCallCenterTotal! - base.coutRetoursTotal!
    : null;

  const ppdo = margeNette != null && livres > 0 ? margeNette / livres : null;

  return { ...base, missingFields, coutSpecifique, margeNette, ppdo };
}
