import {
  fetchClickMarketKpis,
  fetchColiscodKpis,
  fetchAfricodCongoKpis,
  type ClickMarketKpiRow,
  type ColiscodKpiRow,
  type AfricodCongoKpiRow,
} from "@/lib/supabase/queries";
import { fetchPublicMarketSettings } from "@/lib/marketSettings";
import { getCanonicalCountry, COUNTRY_FLAGS } from "@/lib/countries";

// Forme normalisée, strictement identique pour les 4 prestataires (ClickMarket, Coliscod
// Angola, Africod Congo, Shipsen) — voir components/kpi/ProviderKpiTable.tsx.
// Depuis 2026-07 : livres/caLivre/annulees/retournees sont basés sur le statut de LIVRAISON
// (shipping_status pour ClickMarket/Coliscod/Africod Congo, status pour Shipsen) — 'processed'
// = livré + encaissé (frais de livraison fixe de 11$ déjà déduit de caLivre), 'cancelled' =
// annulée, 'return' ('refunded' chez Shipsen) = retournée. confirmes/tauxConfirmation/enAttente/
// ruptureStock (funnel de confirmation) ont été retirés de ce tableau — ils restent calculés
// côté SQL pour les alertes de la page d'accueil (lib/dashboardData.ts) mais ne sont plus
// affichés ici.
export interface ProviderKpiRow {
  countryName: string;
  flag: string;
  currency: string; // devise_locale via market_settings — jamais additionnée entre pays
  totalLeads: number;
  doublons: number; // exclus du calcul des taux, affichés à part (pas des leads réels)
  livres: number;
  tauxLivraison: number | null; // livres / totalLeads
  caLivre: number; // devise locale, net du frais de livraison fixe (11$/commande livrée)
  annulees: number;
  retournees: number; // statut réel sur les 4 réseaux depuis 2026-07 (plus de trou de source)
}

export type ProviderId = "clickmarket" | "coliscod" | "africod-congo" | "shipsen";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  fetchRows: (dateFrom: string, dateTo: string) => Promise<ProviderKpiRow[]>;
}

async function marketSettingsCurrencyMap(): Promise<Map<string, string>> {
  const settings = await fetchPublicMarketSettings();
  return new Map(settings.map((s) => [s.pays, s.devise_locale]));
}

function resolveCountry(rawName: string, currencyMap: Map<string, string>): { name: string; flag: string; currency: string } {
  const canonical = getCanonicalCountry(rawName);
  const name = canonical?.name ?? rawName;
  const flag = canonical?.flag ?? COUNTRY_FLAGS[rawName] ?? "🌍";
  // Devise via market_settings uniquement — source unique de vérité (jamais une constante
  // codée en dur par réseau, c'est exactement le bug qu'on a corrigé pour ClickMarket/Gabon).
  const currency = currencyMap.get(name) ?? "";
  return { name, flag, currency };
}

function normalizeLeadsRow(
  raw: ClickMarketKpiRow | ColiscodKpiRow | AfricodCongoKpiRow,
  currencyMap: Map<string, string>
): ProviderKpiRow {
  const { name, flag, currency } = resolveCountry(raw.country_name, currencyMap);
  return {
    countryName: name,
    flag,
    currency,
    totalLeads: raw.total_leads,
    doublons: raw.doublons,
    livres: raw.livres,
    tauxLivraison: raw.taux_livraison,
    caLivre: raw.ca_livre,
    annulees: raw.annulees,
    retournees: raw.retournees,
  };
}

interface ShipsenRawRow {
  country: string;
  currency: string;
  total_orders: number;
  confirmed_orders: number;
  confirmation_rate: number | null;
  revenue_confirmed: number;
  revenue_delivered: number;
  cancelled_orders: number;
  pending_orders: number;
  en_attente: number;
  annulees: number;
  rupture_stock: number;
  doublons: number;
  retournees: number;
  livres: number;
  taux_livraison: number | null;
}

async function fetchShipsenRows(dateFrom: string, dateTo: string): Promise<ProviderKpiRow[]> {
  const [res, currencyMap] = await Promise.all([
    fetch(`/api/shipsen/kpi?dateFrom=${dateFrom}&dateTo=${dateTo}`),
    marketSettingsCurrencyMap(),
  ]);
  const json = await res.json();
  if (json.error) throw new Error(json.error);

  return ((json.byCountry ?? []) as ShipsenRawRow[]).map((raw) => {
    const { name, flag, currency } = resolveCountry(raw.country, currencyMap);
    return {
      countryName: name,
      flag,
      currency,
      totalLeads: raw.total_orders,
      doublons: raw.doublons,
      livres: raw.livres,
      tauxLivraison: raw.taux_livraison,
      caLivre: raw.revenue_delivered,
      annulees: raw.annulees,
      retournees: raw.retournees,
    };
  });
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  clickmarket: {
    id: "clickmarket",
    label: "ClickMarket",
    fetchRows: async (dateFrom, dateTo) => {
      const [rows, currencyMap] = await Promise.all([
        fetchClickMarketKpis(dateFrom, dateTo),
        marketSettingsCurrencyMap(),
      ]);
      return rows.map((r) => normalizeLeadsRow(r, currencyMap));
    },
  },
  coliscod: {
    id: "coliscod",
    label: "Coliscod Angola",
    fetchRows: async (dateFrom, dateTo) => {
      const [rows, currencyMap] = await Promise.all([
        fetchColiscodKpis(dateFrom, dateTo),
        marketSettingsCurrencyMap(),
      ]);
      return rows.map((r) => normalizeLeadsRow(r, currencyMap));
    },
  },
  "africod-congo": {
    id: "africod-congo",
    label: "Africod Congo",
    fetchRows: async (dateFrom, dateTo) => {
      const [rows, currencyMap] = await Promise.all([
        fetchAfricodCongoKpis(dateFrom, dateTo),
        marketSettingsCurrencyMap(),
      ]);
      return rows.map((r) => normalizeLeadsRow(r, currencyMap));
    },
  },
  shipsen: {
    id: "shipsen",
    label: "Shipsen",
    fetchRows: fetchShipsenRows,
  },
};
