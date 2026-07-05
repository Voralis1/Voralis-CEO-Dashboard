import type { CopilotSnapshot } from "@/lib/copilot/snapshot";
import { STRUCTURAL_BLIND_SPOTS } from "@/lib/copilot/snapshot";
import type { BottleneckAnalysis } from "@/lib/copilot/bottleneck";
import type { CopilotAlertThresholds } from "@/lib/copilot/alertThresholds";

// Alertes proactives RENDUES PAR TEMPLATE (aucun appel LLM ici — choix validé : coût/latence
// d'un appel LLM par chargement de page n'est pas justifié pour un rendu déterministe). Réutilise
// le même CopilotSnapshot et le même BottleneckAnalysis que le chatbot conversationnel
// (app/api/copilot/chat/route.ts) — une seule source de vérité pour "où ça bloque".
//
// Format imposé : chaque alerte = OÙ + QUOI (action) + IMPACT, jamais un chiffre nu.

export type CopilotAlertLevel = "critical" | "warning" | "info";

export interface CopilotAlert {
  id: string;
  level: CopilotAlertLevel;
  ou: string;
  quoi: string;
  impact: string;
  ceoOnly: boolean;
}

// Période précédente de même longueur, immédiatement avant dateFrom — utilisée uniquement pour
// la détection de chute de DR% (comparaison à période égale, pas un simple "mois dernier").
export function previousEquivalentPeriod(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - spanMs);
  const iso = (d: Date) => d.toISOString().split("T")[0];
  return { dateFrom: iso(prevFrom), dateTo: iso(prevTo) };
}

function fmtPct(value: number | null): string {
  return value == null ? "n/d" : `${value}%`;
}

export function computeProactiveAlerts(
  current: CopilotSnapshot,
  previous: CopilotSnapshot | null,
  bottleneck: BottleneckAnalysis,
  thresholds: CopilotAlertThresholds
): CopilotAlert[] {
  const alerts: CopilotAlert[] = [];

  // 1) Délai 1er contact — angle mort structurel permanent, jamais un vrai seuil dépassé (aucune
  // source ne fournit cette donnée) : une seule carte informative stable, jamais dupliquée.
  alerts.push({
    id: "blind-spot-delai-premier-contact",
    level: "info",
    ou: "Toutes les marchés — étape confirmation",
    quoi: "Aucune source connectée n'expose le délai avant le 1er contact commercial. Impossible de déclencher une alerte sur ce KPI tant qu'il n'est pas remonté par un réseau ou le CRM.",
    impact: "Angle mort permanent — action possible : demander aux réseaux COD/CRM Voralis d'exposer ce champ.",
    ceoOnly: false,
  });

  // 2) Rupture de stock imminente / taux out_of_stock élevé
  for (const market of current.markets) {
    for (const product of market.stockProducts) {
      if (product.statut === "rupture") {
        alerts.push({
          id: `stock-rupture-${market.pays}-${product.produit}`,
          level: "critical",
          ou: `${market.pays} — ${product.produit}`,
          quoi: `Stock à 0 — lancer un réapprovisionnement d'urgence et suspendre l'acquisition sur ce produit tant que le stock n'est pas reconstitué.`,
          impact: "Chaque commande confirmée sur ce produit ne peut plus être livrée — perte de livraisons rentables à 100% le temps de la rupture.",
          ceoOnly: false,
        });
      } else if (product.statut === "a_commander") {
        alerts.push({
          id: `stock-a-commander-${market.pays}-${product.produit}`,
          level: "warning",
          ou: `${market.pays} — ${product.produit}`,
          quoi: `Stock sous le seuil de réapprovisionnement (délai d'appro + stock de sécurité) — lancer la commande maintenant pour éviter la rupture.`,
          impact: "Risque de rupture avant la prochaine livraison de stock si aucune commande n'est passée.",
          ceoOnly: false,
        });
      }
      if (product.tauxRuptureStock != null && product.tauxRuptureStock * 100 > thresholds.taux_rupture_stock_max_pct) {
        alerts.push({
          id: `stock-taux-rupture-${market.pays}-${product.produit}`,
          level: "warning",
          ou: `${market.pays} — ${product.produit} (ClickMarket)`,
          quoi: `Taux de rupture de stock à ${(product.tauxRuptureStock * 100).toFixed(1)}%, au-dessus du seuil configuré de ${thresholds.taux_rupture_stock_max_pct}% — sécuriser l'approvisionnement de ce produit avant d'augmenter l'acquisition.`,
          impact: "Des leads confirmés sont perdus faute de stock disponible au moment de l'expédition.",
          ceoOnly: false,
        });
      }
    }
  }

  // 3) CPL / payout réel en zone rouge (seuils déjà team-visibles, cf. lib/thresholds.ts)
  for (const market of current.markets) {
    const { cplColor, cplReelUsd, cplBreakEvenUsd, payoutColor, payoutReelUsd, payoutBreakEvenUsd } = market.threshold;
    if (cplColor === "red") {
      alerts.push({
        id: `cpl-rouge-${market.pays}`,
        level: "critical",
        ou: `${market.pays} — Media Buying Interne`,
        quoi: `CPL réel ($${cplReelUsd?.toFixed(2) ?? "n/d"}) au-dessus du seuil de rentabilité ($${cplBreakEvenUsd?.toFixed(2) ?? "n/d"}) — auditer le ciblage/la créa Meta Ads ou couper la campagne la moins performante.`,
        impact: "Chaque nouveau lead à ce CPL érode la marge plutôt que d'en créer.",
        ceoOnly: false,
      });
    }
    if (payoutColor === "red") {
      alerts.push({
        id: `payout-rouge-${market.pays}`,
        level: "critical",
        ou: `${market.pays} — Affiliés`,
        quoi: `Payout affilié réel ($${payoutReelUsd?.toFixed(2) ?? "n/d"}) au-dessus du seuil de rentabilité ($${payoutBreakEvenUsd?.toFixed(2) ?? "n/d"}) — renégocier la grille de payout ou plafonner les commandes de ce marché.`,
        impact: "Chaque commande affiliée livrée à ce payout érode la marge plutôt que d'en créer.",
        ceoOnly: false,
      });
    }
  }

  // 4) Chute de DR% sur un réseau (Media Buying) ou un affilié — comparaison à période égale.
  if (previous) {
    const prevByCountry = new Map(previous.markets.map((m) => [m.pays, m]));
    for (const market of current.markets) {
      const prevMarket = prevByCountry.get(market.pays);
      const cur = market.funnelTotals.tauxLivraison;
      const prev = prevMarket?.funnelTotals.tauxLivraison ?? null;
      if (cur != null && prev != null && prev - cur >= thresholds.dr_pct_drop_max_points) {
        alerts.push({
          id: `dr-drop-${market.pays}`,
          level: "warning",
          ou: `${market.pays} — Media Buying Interne (DR%)`,
          quoi: `Taux de livraison en baisse de ${(prev - cur).toFixed(1)} points (${fmtPct(prev)} → ${fmtPct(cur)}) sur la période précédente équivalente — auditer la logistique ou le partenaire de livraison.`,
          impact: "Moins de commandes confirmées se transforment en livraisons rentables qu'avant.",
          ceoOnly: false,
        });
      }
    }

    const prevAffiliateById = new Map(previous.affiliateNetworks.map((a) => [a.id, a]));
    for (const aff of current.affiliateNetworks) {
      const prevAff = prevAffiliateById.get(aff.id);
      if (aff.drPct != null && prevAff?.drPct != null && prevAff.drPct - aff.drPct >= thresholds.dr_pct_drop_max_points) {
        alerts.push({
          id: `dr-drop-affilie-${aff.id}`,
          level: "warning",
          ou: `${aff.name} (${aff.networkName})`,
          quoi: `DR% de l'affilié en baisse de ${(prevAff.drPct - aff.drPct).toFixed(1)} points (${fmtPct(prevAff.drPct)} → ${fmtPct(aff.drPct)}) — contacter l'affilié pour comprendre la cause avant de lui allouer plus de budget.`,
          impact: "Le payout par livraison effective augmente mécaniquement si le DR% continue de baisser.",
          ceoOnly: false,
        });
      }
    }
  }

  // 5) Cash non rapatrié au-dessus du seuil configuré
  for (const market of current.markets) {
    const nonRapatrie = market.cashHoldings.filter((h) => h.statutRapatriement !== "rapatrie");
    const totalUsd = nonRapatrie.reduce((s, h) => s + h.montantDetenu / market.fxToUsd, 0);
    if (totalUsd > thresholds.cash_non_rapatrie_max_usd) {
      const entites = nonRapatrie.map((h) => h.entite).join(", ");
      alerts.push({
        id: `cash-non-rapatrie-${market.pays}`,
        level: "warning",
        ou: `${market.pays} — Cash chez qui (${entites})`,
        quoi: `~$${totalUsd.toFixed(0)} de cash non rapatrié, au-dessus du seuil configuré de $${thresholds.cash_non_rapatrie_max_usd} — planifier la remise/le rapatriement avec le partenaire ou le manager local.`,
        impact: "Trésorerie immobilisée hors du compte central — risque opérationnel et de change tant qu'elle n'est pas rapatriée.",
        ceoOnly: false,
      });
    }
  }

  // 6) Rappel des angles morts structurels (une seule fois, jamais recalculé sur un 0 implicite)
  for (const blindSpot of STRUCTURAL_BLIND_SPOTS) {
    if (blindSpot.includes("Délai avant le 1er contact")) continue; // déjà couvert par la carte dédiée ci-dessus
    alerts.push({
      id: `blind-spot-${blindSpot.slice(0, 24)}`,
      level: "info",
      ou: "Toutes les marchés",
      quoi: blindSpot,
      impact: "Angle mort permanent — n'affecte pas le calcul, mais limite la précision du diagnostic.",
      ceoOnly: false,
    });
  }

  // Insights de goulot les plus impactants remontés aussi comme alertes actionnables, pour ne
  // pas dupliquer la logique de priorisation entre le chatbot et le centre d'alertes.
  for (const insight of bottleneck.insights.slice(0, 3)) {
    if (insight.impact.estimation == null) continue; // déjà couvert par les alertes stock/marge ci-dessus si qualitatif
    alerts.push({
      id: `bottleneck-${insight.ou.pays}-${insight.ou.etape}`,
      level: insight.ou.etape === "marge" ? "critical" : "warning",
      ou: `${insight.ou.pays} — ${insight.ou.etape}`,
      quoi: insight.quoi,
      impact: `≈ ${insight.impact.estimation} ${insight.impact.unite}`,
      ceoOnly: false,
    });
  }

  const order: Record<CopilotAlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}
