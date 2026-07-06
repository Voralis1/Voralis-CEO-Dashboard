import { supabaseAdmin } from "@/lib/supabase/server";
import { getCountryCurrency } from "@/lib/countries";

export interface NetworkKpiRow {
  country_id: number;
  country_name: string;
  total_leads: number;
  confirmes: number;
  taux_confirmation: number | null;
  livres: number;
  taux_livraison: number | null;
  ca_livre: number;
  currency: string;
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

// La devise se dérive du pays réel de chaque ligne (lib/countries.ts), jamais d'une
// constante par réseau : ClickMarket est multi-pays (ex. Gabon = XAF) et assigner une
// devise unique au réseau entier reproduisait le bug "Gabon affiché en AOA" (devise
// de l'Angola). On ne les additionne jamais entre eux, seulement au sein d'un même pays/devise.
function attachCurrency(rows: Omit<NetworkKpiRow, "currency">[]): NetworkKpiRow[] {
  return rows.map((row) => ({ ...row, currency: getCountryCurrency(row.country_name) }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  const [metaAdsRes, clickmarketRes, coliscodRes, africodCongoRes, shipsenByCountryRes, shipsenGlobalRes] =
    await Promise.all([
      // meta_ads_by_country a désormais une ligne par (pays, canal, jour) avec une vraie colonne
      // `date` (confirmé le 2026-07-06) — filtrage par période réel, plus un snapshot cumulatif.
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
      { network: "ClickMarket", rows: attachCurrency(clickmarketRes.data ?? []) },
      { network: "Coliscod Angola", rows: attachCurrency(coliscodRes.data ?? []) },
      { network: "Africod Congo", rows: attachCurrency(africodCongoRes.data ?? []) },
    ],
    shipsen: {
      byCountry: (shipsenByCountryRes.data ?? []) as ShipsenCountryKpi[],
      global: shipsenGlobalRes.data ?? null,
    },
    errors,
  });
}
