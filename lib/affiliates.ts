import { getCanonicalCountry, flagFromIsoAlpha2 } from "@/lib/countries";

// CRM Voralis (/api/v1/reports/networks) — vérifié en direct le 2026-07-04 :
//   - "by_country" est un bloc GLOBAL (tous affiliés confondus), pas un croisement
//     affilié × pays. Deux vues séparées seulement : par affilié, et par pays.
//   - Les codes pays ne sont pas normalisés uniformément (AGO en alpha-3, mais
//     CI/MA/GN/SN/... en alpha-2) — lib/countries.ts accepte les deux formats en alias.
//   - Le payout est TOUJOURS en USD, jamais à convertir.
//   - Le CA livré encaissé par affilié/pays n'existe PAS dans cette API — la rentabilité
//     nette reste donc "incomplète" tant que ce n'est pas branché (voir AffiliateMargin ci-dessous).
//
// Règle métier confirmée par le CEO (2026-07-05) : le payout affilié est payé sur la commande
// CONFIRMÉE, pas livrée — EXCEPTION valable uniquement pour ce calcul de coût unitaire du
// payout (ne remet pas en cause la règle générale "l'argent n'existe que sur livré+encaissé"
// pour le CA/la marge, qui reste inchangée partout ailleurs). Le coût payout par unité se
// ramène donc à payout total ÷ commandes CONFIRMÉES, jamais ÷ livrées.

interface RawStats {
  total_orders: number;
  confirmed_orders: number;
  delivered_orders: number;
  total_payout: number;
}

export interface AffiliateRow {
  id: string;
  name: string;
  networkName: string;
  totalOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;
  drPct: number | null; // delivered/confirmed — null si confirmedOrders = 0 (non calculable, pas "manquant")
  totalPayoutUsd: number;
  payoutPerConfirmedUsd: number | null; // null si confirmedOrders = 0 — payé à la confirmation, pas à la livraison
}

export interface CountryAffiliateRow {
  countryCode: string; // code brut renvoyé par l'API (ex. "AGO", "CI")
  countryName: string | null; // nom canonique — null si hors périmètre COD (ex. Maroc, France)
  flag: string;
  totalOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;
  drPct: number | null;
  totalPayoutUsd: number;
  payoutPerConfirmedUsd: number | null;
}

export interface AffiliatesData {
  affiliates: AffiliateRow[];
  byCountry: CountryAffiliateRow[];
  totals: { networks: number; affiliates: number; confirmedOrders: number };
  generatedAt: string;
}

function computeDrPct(stats: RawStats): number | null {
  if (stats.confirmed_orders <= 0) return null;
  return Math.round((stats.delivered_orders / stats.confirmed_orders) * 1000) / 10;
}

// Payout ÷ commandes CONFIRMÉES (pas livrées) — le payout est dû dès la confirmation dans ce
// business, cf. note en tête de fichier.
function computePayoutPerConfirmed(stats: RawStats): number | null {
  if (stats.confirmed_orders <= 0) return null;
  return stats.total_payout / stats.confirmed_orders;
}

export async function fetchAffiliatesData(dateFrom: string, dateTo: string): Promise<AffiliatesData> {
  const res = await fetch(`/api/networks?dateFrom=${dateFrom}&dateTo=${dateTo}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "Erreur CRM Voralis");

  const affiliates: AffiliateRow[] = [];
  for (const network of json.networks ?? []) {
    for (const aff of network.affiliates ?? []) {
      const s: RawStats = aff.stats;
      affiliates.push({
        id: aff.id,
        name: aff.name,
        networkName: network.name,
        totalOrders: s.total_orders,
        confirmedOrders: s.confirmed_orders,
        deliveredOrders: s.delivered_orders,
        drPct: computeDrPct(s),
        totalPayoutUsd: s.total_payout,
        payoutPerConfirmedUsd: computePayoutPerConfirmed(s),
      });
    }
  }

  const byCountry: CountryAffiliateRow[] = (json.by_country ?? []).map((row: { country: string; stats: RawStats }) => {
    const canonical = getCanonicalCountry(row.country);
    return {
      countryCode: row.country,
      countryName: canonical?.name ?? null,
      flag: canonical?.flag ?? flagFromIsoAlpha2(row.country) ?? "🌍",
      totalOrders: row.stats.total_orders,
      confirmedOrders: row.stats.confirmed_orders,
      deliveredOrders: row.stats.delivered_orders,
      drPct: computeDrPct(row.stats),
      totalPayoutUsd: row.stats.total_payout,
      payoutPerConfirmedUsd: computePayoutPerConfirmed(row.stats),
    };
  });

  return {
    affiliates,
    byCountry,
    totals: {
      networks: json.totals?.networks ?? 0,
      affiliates: json.totals?.affiliates ?? 0,
      confirmedOrders: json.totals?.confirmed_orders ?? 0,
    },
    generatedAt: json.generated_at,
  };
}
