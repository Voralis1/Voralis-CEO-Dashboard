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
export interface ProviderKpiRow {
  countryName: string;
  flag: string;
  currency: string; // devise_locale via market_settings — jamais additionnée entre pays
  totalLeads: number;
  doublons: number; // exclus du calcul des taux, affichés à part (pas des leads réels)
  confirmes: number;
  tauxConfirmation: number | null;
  livres: number;
  tauxLivraison: number | null;
  caLivre: number; // devise locale, déjà filtré livré + encaissé (voir migration date-range)
  enAttente: number;
  annulees: number;
  ruptureStock: number; // perte réelle (rupture de stock) — distincte d'une annulation
  retournees: number | null; // null = trou de source dur (réseau n'expose aucune donnée retour)
}

export type ProviderId = "clickmarket" | "coliscod" | "africod-congo" | "shipsen";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  // false = aucune colonne retour en base, "unreliable" = colonne existe mais jamais
  // renseignée à ce jour, true = donnée fiable et exploitable.
  returnedDataStatus: false | "unreliable" | true;
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
    confirmes: raw.confirmes,
    tauxConfirmation: raw.taux_confirmation,
    livres: raw.livres,
    tauxLivraison: raw.taux_livraison,
    caLivre: raw.ca_livre,
    enAttente: raw.en_attente,
    annulees: raw.annulees,
    ruptureStock: raw.rupture_stock,
    retournees: null, // trou de source : aucune colonne retour dans ce réseau
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
      confirmes: raw.confirmed_orders,
      tauxConfirmation: raw.confirmation_rate,
      livres: raw.livres,
      tauxLivraison: raw.taux_livraison,
      caLivre: raw.revenue_delivered,
      enAttente: raw.en_attente,
      annulees: raw.annulees,
      ruptureStock: raw.rupture_stock,
      retournees: raw.retournees, // colonne réelle (is_refunded), même si jamais renseignée
    };
  });
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  clickmarket: {
    id: "clickmarket",
    label: "ClickMarket",
    returnedDataStatus: false,
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
    returnedDataStatus: false,
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
    returnedDataStatus: false,
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
    returnedDataStatus: "unreliable",
    fetchRows: fetchShipsenRows,
  },
};
