import { describe, it, expect } from "vitest";
import { computeThresholdRow } from "./thresholds";
import { computeL } from "./margin";
import type { MarketSettings } from "./marketSettings";

// Marché témoin réaliste (pas les chiffres d'exemple du brief original, qui ignoraient les
// frais de livraison) : fx=830 (AOA/USD), AOV observé=25000 AOA, conf%=45, DR%=75, T=1500 AOA.
// Le coût call center n'est plus un champ séparé (2026-07-06) : confirmé par le CEO comme déjà
// inclus dans les 11 USD/commande de frais de livraison fixe.
// cogs_produit/cogs_devise/taux_retour/frais_retour_local (2026-07-14) : colonnes SUPPRIMÉES de
// market_settings — COGS vient désormais d'un taux forfaitaire partagé (COGS_PRODUCTION_UNIT_USD
// + COGS_SHIPPING_UNIT_USD = 15$/unité, cf. lib/margin.ts), et les retours ont été retirés de la
// formule (demande CEO).
function buildSettings(overrides: Partial<MarketSettings> = {}): MarketSettings {
  return {
    id: "test-id",
    pays: "Angola",
    devise_locale: "AOA",
    fx_to_usd: 830,
    fx_updated_at: "2026-01-01T00:00:00Z",
    fx_updated_by: null,
    conf_pct: 45,
    dr_pct: 75,
    marge_plancher_t: 1500,
    aov_override: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
    delivery_model: overrides.delivery_model ?? "external_11usd",
  };
}

const PERIODE = { dateFrom: "2026-06-01", dateTo: "2026-06-30" };

describe("lib/thresholds — computeThresholdRow (marché témoin, avec frais de livraison réels)", () => {
  it("recalcule toute la chaîne M -> L -> CPL max -> payout max avec le COGS forfaitaire (15$/unité) et les 11$ de frais de livraison", () => {
    const settings = buildSettings();
    const row = computeThresholdRow(settings, 25000, null, null, PERIODE);

    expect(row.missingFields).toEqual([]);
    expect(row.aovUsed).toBe(25000);
    expect(row.aovSource).toBe("observed");
    expect(row.fxMissing).toBe(false);

    // frais_livraison_local = 11 * 830 = 9130 AOA (call center déjà inclus dedans) ; cogs_local =
    // (7+8) * 830 = 12450 AOA (forfait partagé, ne dépend plus de market_settings.cogs_produit) :
    // M_local = (25000 - 9130) - 12450 = 3420 AOA. L = 1/(0.45*0.75) = 80/27 (utilisé par les
    // plafonds CPL, pas par M).
    expect(row.ceoDetail!.L).toBeCloseTo(2.9630, 4);
    expect(row.ceoDetail!.cogsPerUnitLocal).toBeCloseTo(12450, 3);
    expect(row.ceoDetail!.M_local).toBeCloseTo(3420, 3);
    expect(row.ceoDetail!.M_usd).toBeCloseTo(4.1205, 4);
    expect(row.ceoDetail!.T_usd).toBeCloseTo(1.8072, 4);

    expect(row.cplMaxUsd).toBeCloseTo(0.7807, 4);
    expect(row.cplBreakEvenUsd).toBeCloseTo(1.3907, 4);
    expect(row.cplMaxLocal).toBeCloseTo(648, 3);
    // Payout affiliés (2026-07-14) : forfait fixe de 9$ (AFFILIATE_PAYOUT_MAX_USD), plus calculé
    // via dr_pct×(M-T) — break-even déduit par la même proportion que cplBreakEvenUsd/cplMaxUsd
    // (= M_usd/(M_usd-T_usd) = (342/83)/(192/83) = 1.78125) : 9 * 1.78125 = 16.03125.
    expect(row.payoutMaxUsd).toBeCloseTo(9, 4);
    expect(row.payoutBreakEvenUsd).toBeCloseTo(16.03125, 4);

    // Preuve que le frais de livraison n'est pas un ajustement mineur : sans les 11$ déduits,
    // M_usd serait ~15.1 (presque 4x plus) — le COGS forfaitaire (12450 AOA) reste le même, seul
    // le frais de livraison change dans cette comparaison "naïve".
    const cogsLocal = 12450;
    const M_usd_sans_frais_livraison = (25000 - cogsLocal) / 830;
    expect(M_usd_sans_frais_livraison).toBeGreaterThan(row.ceoDetail!.M_usd! * 1.7);
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

  it("conf%/DR% observés sur les réseaux logistiques priment sur la saisie manuelle market_settings (2026-07-14)", () => {
    // settings.conf_pct=45/dr_pct=75, mais on observe 60/50 côté réseaux — L doit refléter
    // l'observé (1/(0.60*0.50) = 10/3), pas la saisie manuelle.
    const settings = buildSettings();
    const row = computeThresholdRow(settings, 25000, null, null, PERIODE, null, 0, 60, 50);

    expect(row.ceoDetail!.L).toBeCloseTo(3.3333, 4);
  });

  it("repli sur market_settings.conf_pct/dr_pct quand aucune donnée observée n'est disponible (marché sans commande sur la période)", () => {
    const settings = buildSettings();
    const row = computeThresholdRow(settings, 25000, null, null, PERIODE, null, 0, null, null);

    // Sans observé, on retombe sur conf_pct=45/dr_pct=75 de settings → L = 1/(0.45*0.75) = 80/27.
    expect(row.ceoDetail!.L).toBeCloseTo(2.9630, 4);
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

    // cplMaxUsd ≈ 0.7807, cplBreakEvenUsd ≈ 1.3907 pour ce marché témoin (cf. test précédent).
    expect(computeThresholdRow(settings, 25000, 0.5, null, PERIODE).cplColor).toBe("green");
    expect(computeThresholdRow(settings, 25000, 1.0, null, PERIODE).cplColor).toBe("orange");
    expect(computeThresholdRow(settings, 25000, 2.0, null, PERIODE).cplColor).toBe("red");
    expect(computeThresholdRow(settings, 25000, null, null, PERIODE).cplColor).toBeNull();
  });
});
