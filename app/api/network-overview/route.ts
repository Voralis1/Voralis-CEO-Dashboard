import { supabaseAdmin } from "@/lib/supabase/server";

export interface NetworkKpiRow {
  country_id: number;
  country_name: string;
  total_leads: number;
  confirmes: number;
  taux_confirmation: number | null;
  livres: number;
  taux_livraison: number | null;
  ca_livre: number;
}

export interface MetaAdsRow {
  channel: string;
  country: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  ctr: number;
  date: string | null;
}

export interface ShipsenCountryKpi {
  country: string;
  currency: string;
  total_orders: number;
  confirmed_orders: number;
  confirmation_rate: number | null;
  revenue_confirmed: number;
  revenue_delivered: number;
  cancelled_orders: number;
  pending_orders: number;
}

// Chaque réseau a sa propre devise (voir les commentaires dans les schémas SQL) —
// on ne les additionne jamais entre eux, seulement au sein d'un même réseau/devise.
const NETWORK_CURRENCY: Record<string, string> = {
  ClickMarket: "AOA",
  "Coliscod Angola": "AOA",
  "Africod Congo": "XAF",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  const [metaAdsRes, clickmarketRes, coliscodRes, africodCongoRes, shipsenByCountryRes, shipsenGlobalRes] =
    await Promise.all([
      supabaseAdmin
        .from("meta_ads_by_country")
        .select("channel, country, spend, impressions, clicks, leads, cpl, ctr, date")
        .gte("date", dateFrom)
        .lte("date", dateTo),
      supabaseAdmin.rpc("kpi_clickmarket_marche_periode", { date_from: dateFrom, date_to: dateTo }),
      supabaseAdmin.rpc("kpi_coliscod_marche_periode", { date_from: dateFrom, date_to: dateTo }),
      supabaseAdmin.rpc("kpi_africod_congo_marche_periode", { date_from: dateFrom, date_to: dateTo }),
      supabaseAdmin.rpc("kpi_shipsen_marche_periode", { date_from: dateFrom, date_to: dateTo }),
      supabaseAdmin.rpc("kpi_shipsen_global_periode", { date_from: dateFrom, date_to: dateTo }).single(),
    ]);

  const errors: Record<string, string> = {};
  if (metaAdsRes.error) errors.metaAds = metaAdsRes.error.message;
  if (clickmarketRes.error) errors.clickmarket = clickmarketRes.error.message;
  if (coliscodRes.error) errors.coliscod = coliscodRes.error.message;
  if (africodCongoRes.error) errors.africodCongo = africodCongoRes.error.message;
  if (shipsenByCountryRes.error || shipsenGlobalRes.error)
    errors.shipsen = shipsenByCountryRes.error?.message ?? shipsenGlobalRes.error?.message ?? "Unknown error";

  return Response.json({
    metaAds: (metaAdsRes.data ?? []) as MetaAdsRow[],
    networks: [
      { network: "ClickMarket", currency: NETWORK_CURRENCY["ClickMarket"], rows: (clickmarketRes.data ?? []) as NetworkKpiRow[] },
      { network: "Coliscod Angola", currency: NETWORK_CURRENCY["Coliscod Angola"], rows: (coliscodRes.data ?? []) as NetworkKpiRow[] },
      { network: "Africod Congo", currency: NETWORK_CURRENCY["Africod Congo"], rows: (africodCongoRes.data ?? []) as NetworkKpiRow[] },
    ],
    shipsen: {
      byCountry: (shipsenByCountryRes.data ?? []) as ShipsenCountryKpi[],
      global: shipsenGlobalRes.data ?? null,
    },
    errors,
  });
}
