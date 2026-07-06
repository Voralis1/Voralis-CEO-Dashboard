import type { CopilotSnapshot, MarketSnapshot } from "@/lib/copilot/snapshot";

// Moteur DÉTERMINISTE (aucun appel LLM ici, testable unitairement comme lib/margin.ts et
// lib/thresholds.ts) qui transforme un CopilotSnapshot en un classement de goulots
// d'étranglement vis-à-vis de l'objectif directeur unique : 50 commandes livrées ET encaissées
// ET rentables par jour. Le LLM (app/api/copilot/chat/route.ts) ne fait QUE reformuler la sortie
// de ce module en langage naturel — il ne recalcule et n'invente aucun chiffre.
//
// "Rentable" ne peut être évalué avec certitude que pour Media Buying Interne (les 4 réseaux
// COD) : le CA encaissé par affilié n'existe dans aucune source (cf. STRUCTURAL_BLIND_SPOTS
// dans lib/copilot/snapshot.ts), donc les commandes affiliées ne peuvent JAMAIS être comptées
// dans l'objectif — c'est un angle mort structurel signalé explicitement, jamais un 0 implicite.
export const DAILY_TARGET_RENTABLE_LIVRAISONS = 50;

export type FunnelStage = "acquisition" | "confirmation" | "livraison" | "marge" | "stock";

export interface BottleneckInsight {
  priorite: number; // 1 = plus urgent
  ou: { pays: string; network?: string; etape: FunnelStage };
  quoi: string;
  impact: { estimation: number | null; unite: string };
  angleMort?: string;
}

export interface MarketBottleneckDetail {
  pays: string;
  livresParJour: number;
  estRentable: boolean | null; // null = non calculable (marge ET seuils indisponibles)
  rentableProxy: boolean; // true = estimé via le feu tricolore CPL/payout, pas la marge exacte
  livresRentablesParJour: number; // jamais compté rentable par défaut (false/null → 0)
}

export interface BottleneckAnalysis {
  cibleJour: number;
  livresRentablesJourActuel: number;
  ecartJour: number;
  parMarche: MarketBottleneckDetail[];
  insights: BottleneckInsight[];
  angleMortObjectif: string | null;
}

const MIN_LEADS_FOR_BENCHMARK = 15; // échantillon trop petit sinon pour comparer des taux entre marchés

function classifyRentability(market: MarketSnapshot): { estRentable: boolean | null; proxy: boolean } {
  if (market.mediaBuying.margin) {
    const margeNette = market.mediaBuying.margin.margeNette;
    if (margeNette != null) return { estRentable: margeNette > 0, proxy: false };
  }
  const { cplColor, payoutColor } = market.threshold;
  if (cplColor != null || payoutColor != null) {
    const estRentable = cplColor !== "red" && payoutColor !== "red";
    return { estRentable, proxy: true };
  }
  return { estRentable: null, proxy: true };
}

function marginDriverLabel(market: MarketSnapshot): string {
  const { cplColor, payoutColor } = market.threshold;
  const drivers: string[] = [];
  if (cplColor === "red") drivers.push("le CPL réel (Media Buying / Meta Ads) dépasse le seuil de rentabilité");
  if (payoutColor === "red") drivers.push("le payout affilié réel dépasse le seuil de rentabilité");
  if (drivers.length === 0) return "la marge nette est négative (COGS + retours + frais de livraison, qui inclut le call center, dépassent le CA encaissé)";
  return drivers.join(" et ");
}

export function computeBottleneckAnalysis(snapshot: CopilotSnapshot): BottleneckAnalysis {
  const { markets, periode } = snapshot;

  const parMarche: MarketBottleneckDetail[] = markets.map((market) => {
    const livresParJour = market.funnelTotals.livres / periode.nbJours;
    const { estRentable, proxy } = classifyRentability(market);
    const livresRentablesParJour = estRentable === true ? livresParJour : 0;
    return { pays: market.pays, livresParJour, estRentable, rentableProxy: proxy, livresRentablesParJour };
  });

  const livresRentablesJourActuel = parMarche.reduce((s, m) => s + m.livresRentablesParJour, 0);
  const ecartJour = DAILY_TARGET_RENTABLE_LIVRAISONS - livresRentablesJourActuel;

  const usedProxy = parMarche.some((m) => m.rentableProxy);
  const angleMortObjectif = usedProxy
    ? "Le rôle actuel ne donne pas accès à la marge nette exacte : la rentabilité par marché est estimée via le feu CPL/payout (seuils), pas la marge réelle. Un CEO peut affiner ce chiffre."
    : null;

  const insights: BottleneckInsight[] = [];

  // 1) Marge/zone rouge — priorité maximale : faire croître un marché non rentable aggrave
  // l'écart à l'objectif, donc on traite d'abord la rentabilité avant le volume.
  for (const market of markets) {
    const detail = parMarche.find((m) => m.pays === market.pays)!;
    if (detail.estRentable === false) {
      insights.push({
        priorite: 0, // provisoire, retrié par estimation plus bas
        ou: { pays: market.pays, etape: "marge" },
        quoi: detail.rentableProxy
          ? `Vérifier pourquoi ${market.pays} est en zone rouge (${marginDriverLabel(market)}) — chaque commande livrée y creuse la perte plutôt que de compter vers l'objectif.`
          : `Corriger la rentabilité de ${market.pays} avant d'investir en volume : ${marginDriverLabel(market)}.`,
        impact: { estimation: Math.round(detail.livresParJour * 10) / 10, unite: "livraisons/jour actuellement perdues (non rentables)" },
      });
    } else if (detail.estRentable === null) {
      insights.push({
        priorite: 0,
        ou: { pays: market.pays, etape: "marge" },
        quoi: `Configurer les paramètres de coût de ${market.pays} (COGS, taux de retour dans Paramètres marché) — sans cela, impossible de savoir si ce marché contribue à l'objectif des 50 livraisons rentables/jour.`,
        impact: { estimation: null, unite: "livraisons/jour non classables" },
        angleMort: "Marge non calculable : au moins un paramètre de coût (COGS, taux de retour) n'est pas encore saisi pour ce marché.",
      });
    }
  }

  // 2) Goulot de funnel (confirmation/livraison) — uniquement comparé contre le meilleur marché
  // du même KPI, jamais contre une référence confidentielle (conf_pct/dr_pct de market_settings
  // restent dans ceoDetail). Ne compte que pour les marchés déjà rentables (ou non classables) :
  // faire grossir un marché non rentable n'aide pas l'objectif.
  const eligibleForGrowth = markets.filter((m) => {
    const d = parMarche.find((x) => x.pays === m.pays)!;
    return d.estRentable !== false;
  });

  const confCandidates = eligibleForGrowth.filter((m) => m.funnelTotals.totalLeads >= MIN_LEADS_FOR_BENCHMARK && m.funnelTotals.tauxConfirmation != null);
  const bestConf = confCandidates.length > 0 ? Math.max(...confCandidates.map((m) => m.funnelTotals.tauxConfirmation!)) : null;

  const drCandidates = eligibleForGrowth.filter((m) => m.funnelTotals.confirmes >= MIN_LEADS_FOR_BENCHMARK && m.funnelTotals.tauxLivraison != null);
  const bestDr = drCandidates.length > 0 ? Math.max(...drCandidates.map((m) => m.funnelTotals.tauxLivraison!)) : null;

  for (const market of eligibleForGrowth) {
    const { totalLeads, tauxConfirmation, confirmes, tauxLivraison } = market.funnelTotals;

    if (bestConf != null && tauxConfirmation != null && totalLeads >= MIN_LEADS_FOR_BENCHMARK && tauxConfirmation < bestConf) {
      const extraConfirmesPerDay = (totalLeads / periode.nbJours) * ((bestConf - tauxConfirmation) / 100);
      const drForEstimate = tauxLivraison ?? 0;
      const extraLivresPerDay = extraConfirmesPerDay * (drForEstimate / 100);
      insights.push({
        priorite: 0,
        ou: { pays: market.pays, etape: "confirmation" },
        quoi: `Auditer le script de confirmation à ${market.pays} (${tauxConfirmation}% vs ${bestConf}% sur le meilleur marché) — relances plus rapides ou reformulation du script d'appel.`,
        impact: {
          estimation: Math.round(extraLivresPerDay * 10) / 10,
          unite: "livraisons rentables/jour supplémentaires estimées si le taux de confirmation rejoignait le meilleur marché",
        },
        angleMort: tauxLivraison == null ? "Taux de livraison de ce marché indisponible sur la période — estimation d'impact prudente (calculée à DR%=0)." : undefined,
      });
    }

    if (bestDr != null && tauxLivraison != null && confirmes >= MIN_LEADS_FOR_BENCHMARK && tauxLivraison < bestDr) {
      const extraLivresPerDay = (confirmes / periode.nbJours) * ((bestDr - tauxLivraison) / 100);
      insights.push({
        priorite: 0,
        ou: { pays: market.pays, etape: "livraison" },
        quoi: `Auditer la logistique/le partenaire de livraison à ${market.pays} (taux de livraison ${tauxLivraison}% vs ${bestDr}% sur le meilleur marché).`,
        impact: {
          estimation: Math.round(extraLivresPerDay * 10) / 10,
          unite: "livraisons rentables/jour supplémentaires estimées si le taux de livraison rejoignait le meilleur marché",
        },
      });
    }
  }

  // 3) Risque de rupture de stock — qualitatif (impact non quantifiable précisément), toujours
  // secondaire aux insights chiffrés ci-dessus mais avant les seuls angles morts informatifs.
  for (const market of markets) {
    const enRupture = market.stockProducts.filter((p) => p.statut === "rupture");
    const aCommander = market.stockProducts.filter((p) => p.statut === "a_commander");
    if (enRupture.length > 0) {
      insights.push({
        priorite: 0,
        ou: { pays: market.pays, etape: "stock" },
        quoi: `Réapprovisionner en urgence : ${enRupture.map((p) => p.produit).join(", ")} en rupture à ${market.pays} — chaque lead confirmé sur ce produit ne peut pas être livré tant que le stock n'est pas reconstitué.`,
        impact: { estimation: null, unite: "livraisons bloquées par rupture (non quantifiable précisément)" },
      });
    }
    if (aCommander.length > 0) {
      insights.push({
        priorite: 0,
        ou: { pays: market.pays, etape: "stock" },
        quoi: `Lancer une commande de réapprovisionnement pour ${aCommander.map((p) => p.produit).join(", ")} à ${market.pays} avant d'atteindre la rupture.`,
        impact: { estimation: null, unite: "risque de rupture à venir" },
      });
    }
  }

  // Tri : insights chiffrés (estimation non-null) par impact décroissant, puis insights
  // qualitatifs (stock en rupture avant "à commander"), angles morts en dernier.
  const rankOrder = (i: BottleneckInsight): number => {
    if (i.impact.estimation != null) return 0;
    if (i.ou.etape === "stock") return 1;
    return 2;
  };
  insights.sort((a, b) => {
    const r = rankOrder(a) - rankOrder(b);
    if (r !== 0) return r;
    return (b.impact.estimation ?? 0) - (a.impact.estimation ?? 0);
  });
  insights.forEach((insight, idx) => {
    insight.priorite = idx + 1;
  });

  return { cibleJour: DAILY_TARGET_RENTABLE_LIVRAISONS, livresRentablesJourActuel, ecartJour, parMarche, insights, angleMortObjectif };
}
