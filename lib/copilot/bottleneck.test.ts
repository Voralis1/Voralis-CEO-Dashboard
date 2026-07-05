import { describe, it, expect } from "vitest";
import { computeBottleneckAnalysis, DAILY_TARGET_RENTABLE_LIVRAISONS } from "@/lib/copilot/bottleneck";
import type { CopilotSnapshot, MarketSnapshot } from "@/lib/copilot/snapshot";

function baseThreshold(overrides: Partial<MarketSnapshot["threshold"]> = {}): MarketSnapshot["threshold"] {
  return {
    pays: "Angola",
    currency: "AOA",
    missingFields: [],
    fxMissing: false,
    aovUsed: 20000,
    aovSource: "observed",
    periodeReel: { dateFrom: "2026-06-01", dateTo: "2026-06-30" },
    cplMaxUsd: 5,
    cplBreakEvenUsd: 6,
    cplMaxLocal: 5000,
    payoutMaxUsd: 8,
    payoutBreakEvenUsd: 10,
    cplReelUsd: null,
    payoutReelUsd: null,
    cplColor: null,
    payoutColor: null,
    ...overrides,
  };
}

function baseMarket(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    pays: "Angola",
    currency: "AOA",
    fxToUsd: 900,
    funnel: [],
    funnelTotals: {
      totalLeads: 100,
      confirmes: 50,
      tauxConfirmation: 50,
      livres: 30,
      tauxLivraison: 60,
      caLivre: 600000,
      enAttente: 5,
      annulees: 10,
      ruptureStock: 0,
      doublons: 2,
    },
    mediaBuying: { adSpendUsd: 100, adSpendKnown: true },
    threshold: baseThreshold(),
    affiliatesCountry: null,
    stockProducts: [],
    cashHoldings: [],
    ...overrides,
  };
}

function snapshotWith(markets: MarketSnapshot[], nbJours = 30): CopilotSnapshot {
  return {
    role: "ceo",
    periode: { dateFrom: "2026-06-01", dateTo: "2026-06-30", nbJours },
    markets,
    affiliateNetworks: [],
    affiliatesError: null,
    blindSpots: [],
  };
}

describe("computeBottleneckAnalysis", () => {
  it("classifies a market as rentable from margeNette > 0 (CEO, real margin) and counts its livres/day", () => {
    const market = baseMarket({
      pays: "Sénégal",
      mediaBuying: {
        adSpendUsd: 100,
        adSpendKnown: true,
        margin: {
          fraisLivraisonTotal: 1000,
          revenuNetLivraison: 5000,
          cogsTotal: 1000,
          coutCallCenterTotal: 300,
          coutRetoursTotal: 200,
          missingFields: [],
          coutSpecifique: 500,
          margeNette: 3000,
          ppdo: 100,
        },
      },
      funnelTotals: { ...baseMarket().funnelTotals, livres: 60 },
    });
    const analysis = computeBottleneckAnalysis(snapshotWith([market], 30));
    const detail = analysis.parMarche[0];
    expect(detail.estRentable).toBe(true);
    expect(detail.rentableProxy).toBe(false);
    expect(detail.livresRentablesParJour).toBeCloseTo(60 / 30, 5);
    expect(analysis.livresRentablesJourActuel).toBeCloseTo(2, 5);
    expect(analysis.ecartJour).toBeCloseTo(DAILY_TARGET_RENTABLE_LIVRAISONS - 2, 5);
    expect(analysis.angleMortObjectif).toBeNull();
  });

  it("never counts a market as rentable when margeNette is negative, and ranks its margin fix first", () => {
    const lossy = baseMarket({
      pays: "Congo",
      mediaBuying: {
        adSpendUsd: 900,
        adSpendKnown: true,
        margin: {
          fraisLivraisonTotal: 1000,
          revenuNetLivraison: 2000,
          cogsTotal: 1000,
          coutCallCenterTotal: 300,
          coutRetoursTotal: 200,
          missingFields: [],
          coutSpecifique: 900,
          margeNette: -400,
          ppdo: -13.3,
        },
      },
      funnelTotals: { ...baseMarket().funnelTotals, livres: 30 },
    });
    const analysis = computeBottleneckAnalysis(snapshotWith([lossy], 30));
    expect(analysis.parMarche[0].estRentable).toBe(false);
    expect(analysis.parMarche[0].livresRentablesParJour).toBe(0);
    expect(analysis.livresRentablesJourActuel).toBe(0);
    expect(analysis.insights[0].ou.etape).toBe("marge");
    expect(analysis.insights[0].ou.pays).toBe("Congo");
    expect(analysis.insights[0].impact.estimation).toBeCloseTo(1, 5); // 30 livres / 30 jours
  });

  it("falls back to the CPL/payout traffic-light proxy when margin is not exposed (team role) and flags it as an angle mort", () => {
    const market = baseMarket({
      pays: "Mali",
      mediaBuying: { adSpendUsd: 500, adSpendKnown: true }, // no margin field at all (team)
      threshold: baseThreshold({ cplColor: "red", payoutColor: null }),
    });
    const analysis = computeBottleneckAnalysis(snapshotWith([market], 30));
    expect(analysis.parMarche[0].rentableProxy).toBe(true);
    expect(analysis.parMarche[0].estRentable).toBe(false); // cplColor red => not rentable
    expect(analysis.angleMortObjectif).not.toBeNull();
  });

  it("returns estRentable=null (never silently profitable) when neither margin nor threshold colors are available", () => {
    const market = baseMarket({
      mediaBuying: { adSpendUsd: 0, adSpendKnown: false },
      threshold: baseThreshold({ cplColor: null, payoutColor: null }),
    });
    const analysis = computeBottleneckAnalysis(snapshotWith([market], 30));
    expect(analysis.parMarche[0].estRentable).toBeNull();
    expect(analysis.parMarche[0].livresRentablesParJour).toBe(0);
    const margeInsight = analysis.insights.find((i) => i.ou.etape === "marge");
    expect(margeInsight?.angleMort).toBeDefined();
  });

  it("ranks a confirmation-rate gap against the best-performing market and estimates extra profitable deliveries/day", () => {
    const strong = baseMarket({
      pays: "Gabon",
      funnelTotals: { ...baseMarket().funnelTotals, totalLeads: 200, confirmes: 120, tauxConfirmation: 60, livres: 90, tauxLivraison: 75 },
      mediaBuying: {
        adSpendUsd: 100,
        adSpendKnown: true,
        margin: {
          fraisLivraisonTotal: 500,
          revenuNetLivraison: 5000,
          cogsTotal: 1000,
          coutCallCenterTotal: 300,
          coutRetoursTotal: 200,
          missingFields: [],
          coutSpecifique: 500,
          margeNette: 3000,
          ppdo: 33,
        },
      },
    });
    const weak = baseMarket({
      pays: "Guinée",
      funnelTotals: { ...baseMarket().funnelTotals, totalLeads: 200, confirmes: 60, tauxConfirmation: 30, livres: 36, tauxLivraison: 60 },
      mediaBuying: {
        adSpendUsd: 100,
        adSpendKnown: true,
        margin: {
          fraisLivraisonTotal: 500,
          revenuNetLivraison: 5000,
          cogsTotal: 1000,
          coutCallCenterTotal: 300,
          coutRetoursTotal: 200,
          missingFields: [],
          coutSpecifique: 500,
          margeNette: 3000,
          ppdo: 33,
        },
      },
    });
    const analysis = computeBottleneckAnalysis(snapshotWith([strong, weak], 30));
    const confInsight = analysis.insights.find((i) => i.ou.etape === "confirmation" && i.ou.pays === "Guinée");
    expect(confInsight).toBeDefined();
    // extraConfirmes/day = (200/30) * (60-30)/100 = 2 ; extraLivres/day = 2 * (60/100) = 1.2
    expect(confInsight!.impact.estimation).toBeCloseTo(1.2, 1);
  });

  it("does not propose funnel growth for a market already classified as non-rentable", () => {
    const lossy = baseMarket({
      pays: "Congo",
      funnelTotals: { ...baseMarket().funnelTotals, totalLeads: 200, confirmes: 60, tauxConfirmation: 30, livres: 36, tauxLivraison: 60 },
      mediaBuying: {
        adSpendUsd: 900,
        adSpendKnown: true,
        margin: {
          fraisLivraisonTotal: 500,
          revenuNetLivraison: 2000,
          cogsTotal: 1000,
          coutCallCenterTotal: 300,
          coutRetoursTotal: 200,
          missingFields: [],
          coutSpecifique: 900,
          margeNette: -100,
          ppdo: -2.7,
        },
      },
    });
    const strong = baseMarket({
      pays: "Gabon",
      funnelTotals: { ...baseMarket().funnelTotals, totalLeads: 200, confirmes: 120, tauxConfirmation: 60, livres: 90, tauxLivraison: 75 },
    });
    const analysis = computeBottleneckAnalysis(snapshotWith([lossy, strong], 30));
    expect(analysis.insights.some((i) => i.ou.etape === "confirmation" && i.ou.pays === "Congo")).toBe(false);
  });

  it("flags an urgent stock-rupture insight ahead of qualitative-only 'à commander' insights", () => {
    const market = baseMarket({
      pays: "Sénégal",
      stockProducts: [
        { produit: "Produit A", quantiteStock: 0, seuilAlerte: 20, statut: "rupture", tauxRuptureStock: 0.4 },
        { produit: "Produit B", quantiteStock: 15, seuilAlerte: 20, statut: "a_commander", tauxRuptureStock: null },
      ],
    });
    const analysis = computeBottleneckAnalysis(snapshotWith([market], 30));
    const stockInsights = analysis.insights.filter((i) => i.ou.etape === "stock");
    expect(stockInsights).toHaveLength(2);
    expect(stockInsights[0].quoi).toContain("Produit A");
  });
});
