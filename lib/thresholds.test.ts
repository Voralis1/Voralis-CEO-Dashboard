import { describe, it, expect } from "vitest";
import { computeThresholdRow } from "./thresholds";
import { computeL } from "./margin";
import type { MarketSettings } from "./marketSettings";

// Marché témoin réaliste (pas les chiffres d'exemple du brief original, qui ignoraient les
// frais de livraison) : fx=830 (AOA/USD), AOV observé=25000 AOA, COGS=3000 AOA, coût call
// center=300 AOA, taux retour=8%, conf%=45, DR%=75, T=1500 AOA.
function buildSettings(overrides: Partial<MarketSettings> = {}): MarketSettings {
  return {
    id: "test-id",
    pays: "Angola",
    devise_locale: "AOA",
    fx_to_usd: 830,
    fx_updated_at: "2026-01-01T00:00:00Z",
    fx_updated_by: null,
    cogs_produit: 3000,
    cogs_devise: "local",
    cout_call_center_par_commande: 300,
    taux_retour: 8,
    conf_pct: 45,
    dr_pct: 75,
    frais_retour_local: 0,
    marge_plancher_t: 1500,
    aov_override: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const PERIODE = { dateFrom: "2026-06-01", dateTo: "2026-06-30" };

describe("lib/thresholds — computeThresholdRow (marché témoin, avec frais de livraison réels)", () => {
  it("recalcule toute la chaîne M -> L -> CPL max -> payout max en tenant compte des 11$ de frais de livraison", () => {
    const settings = buildSettings();
    const row = computeThresholdRow(settings, 25000, null, null, PERIODE);

    expect(row.missingFields).toEqual([]);
    expect(row.aovUsed).toBe(25000);
    expect(row.aovSource).toBe("observed");
    expect(row.fxMissing).toBe(false);

    // frais_livraison_local = 11 * 830 = 9130 AOA — vérifié en creusant M_local :
    // M = (25000 - 9130) - 3000 - (300 * L) - (0.08 * 9130), avec L = 1/(0.45*0.75) = 80/27.
    expect(row.ceoDetail!.L).toBeCloseTo(2.9630, 4);
    expect(row.ceoDetail!.M_local).toBeCloseTo(11250.7111, 3);
    expect(row.ceoDetail!.M_usd).toBeCloseTo(13.5551, 4);
    expect(row.ceoDetail!.T_usd).toBeCloseTo(1.8072, 4);

    expect(row.cplMaxUsd).toBeCloseTo(3.9649, 4);
    expect(row.cplBreakEvenUsd).toBeCloseTo(4.5748, 4);
    expect(row.payoutMaxUsd).toBeCloseTo(8.8109, 4);
    expect(row.payoutBreakEvenUsd).toBeCloseTo(10.1663, 4);

    // Preuve que le frais de livraison n'est pas un ajustement mineur : sans les 11$ déduits,
    // M_usd serait ~24.5 (quasiment le double) — l'exemple du brief original (M=12, sans frais)
    // ne reflète pas la réalité une fois le frais de livraison réellement déduit.
    const cogsLocal = 3000;
    const callCenterLocal = 300 * (1 / (0.45 * 0.75));
    const retoursLocalSansFrais = 0.08 * 0; // pas de frais de livraison dans ce calcul "naïf"
    const M_usd_sans_frais_livraison = (25000 - cogsLocal - callCenterLocal - retoursLocalSansFrais) / 830;
    expect(M_usd_sans_frais_livraison).toBeGreaterThan(row.ceoDetail!.M_usd! * 1.7);
  });

  it('affiche "indisponible" (aucun plafond calculé, pas de 0 implicite) si le COGS est NULL', () => {
    const settings = buildSettings({ cogs_produit: null });
    const row = computeThresholdRow(settings, 25000, null, null, PERIODE);

    expect(row.missingFields).toContain("COGS produit");
    expect(row.ceoDetail!.M_local).toBeNull();
    expect(row.ceoDetail!.M_usd).toBeNull();
    expect(row.cplMaxUsd).toBeNull();
    expect(row.cplBreakEvenUsd).toBeNull();
    expect(row.payoutMaxUsd).toBeNull();
    expect(row.payoutBreakEvenUsd).toBeNull();
    expect(row.cplColor).toBeNull();
    expect(row.payoutColor).toBeNull();
  });

  it("gère conf%/DR% NULL ou 0 sans crash ni Infinity — L doit être null, jamais Infinity/NaN", () => {
    expect(computeL(null, 75)).toBeNull();
    expect(computeL(45, null)).toBeNull();
    expect(computeL(0, 75)).toBeNull();
    expect(computeL(45, 0)).toBeNull();

    const settings = buildSettings({ conf_pct: 0 });
    const row = computeThresholdRow(settings, 25000, null, null, PERIODE);

    expect(row.ceoDetail!.L).toBeNull();
    expect(row.cplMaxUsd).toBeNull();
    expect(row.cplBreakEvenUsd).toBeNull();
    expect(row.missingFields.some((m) => m.includes("confirmation"))).toBe(true);
  });

  it("AOV manquant (aucune commande livrée, pas de surcharge) : tout le module s'affiche indisponible", () => {
    const settings = buildSettings();
    const row = computeThresholdRow(settings, null, null, null, PERIODE);

    expect(row.aovUsed).toBeNull();
    expect(row.aovSource).toBeNull();
    expect(row.missingFields.some((m) => m.includes("AOV"))).toBe(true);
    expect(row.cplMaxUsd).toBeNull();
    expect(row.payoutMaxUsd).toBeNull();
  });

  it("aov_override (surcharge CEO) prend le pas sur l'AOV observé et le signale comme tel", () => {
    const settings = buildSettings({ aov_override: 30000 });
    const row = computeThresholdRow(settings, 25000, null, null, PERIODE);

    expect(row.aovUsed).toBe(30000);
    expect(row.aovSource).toBe("override");
  });

  it("code couleur : vert si réel <= max, orange si max < réel <= break-even, rouge si réel > break-even, null si pas de réel", () => {
    const settings = buildSettings();

    expect(computeThresholdRow(settings, 25000, 3.5, null, PERIODE).cplColor).toBe("green");
    expect(computeThresholdRow(settings, 25000, 4.2, null, PERIODE).cplColor).toBe("orange");
    expect(computeThresholdRow(settings, 25000, 6, null, PERIODE).cplColor).toBe("red");
    expect(computeThresholdRow(settings, 25000, null, null, PERIODE).cplColor).toBeNull();
  });
});
