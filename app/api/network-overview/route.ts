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
  // Manquants jusqu'au 2026-08-04 : les RPC kpi_*_marche_periode renvoient bien ces colonnes
  // (mêmes forme que kpi_shipsen_marche_periode) mais le typage ne les exposait pas, donc
  // computeAlerts (lib/dashboardData.ts) n'a jamais pu déclencher d'alerte livraison sur ces
  // réseaux malgré ce qu'affiche le référentiel en bas de la page Alertes.
  livres: number;
  taux_livraison: number | null;
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

  const [
    metaAdsRes,
    clickmarketRes,
    coliscodRes,
    africodCongoRes,
    shipsenRes,
    shipsenGlobalRes,
    shipleadRes,
    mlshipafricaRes,
    ikatchiexpressRes,
  ] = await Promise.all([
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
    // ShipLead/MLShipAfrica/Ikatchiexpress (ajoutés 2026-08-04) — même forme de sortie que
    // kpi_shipsen_marche_periode (voir lib/providerKpi.ts, normalizeShipsenFamilyRow). Oubliés
    // ici lors de leur intégration (même angle mort que celui déjà corrigé dans lib/thresholds.ts)
    // : sans ça, Cameroun/Argentine (ShipLead), Burkina Faso (MLShipAfrica) et Maroc
    // (Ikatchiexpress) ne pouvaient jamais déclencher d'alerte confirmation/livraison.
    supabaseAdmin.rpc("kpi_shiplead_marche_periode", { date_from: dateFrom, date_to: dateTo }),
    supabaseAdmin.rpc("kpi_mlshipafrica_marche_periode", { date_from: dateFrom, date_to: dateTo }),
    supabaseAdmin.rpc("kpi_ikatchiexpress_marche_periode", { date_from: dateFrom, date_to: dateTo }),
  ]);

  const errors: Record<string, string> = {};
  if (metaAdsRes.error) errors.metaAds = metaAdsRes.error.message;
  if (clickmarketRes.error) errors.clickmarket = clickmarketRes.error.message;
  if (coliscodRes.error) errors.coliscod = coliscodRes.error.message;
  if (africodCongoRes.error) errors.africodCongo = africodCongoRes.error.message;
  if (shipsenRes.error || shipsenGlobalRes.error)
    errors.shipsen = shipsenRes.error?.message ?? shipsenGlobalRes.error?.message ?? "Unknown error";
  if (shipleadRes.error) errors.shiplead = shipleadRes.error.message;
  if (mlshipafricaRes.error) errors.mlshipafrica = mlshipafricaRes.error.message;
  if (ikatchiexpressRes.error) errors.ikatchiexpress = ikatchiexpressRes.error.message;

  return Response.json({
    metaAds: (metaAdsRes.data ?? []) as MetaAdsRow[],
    networks: [
      { network: "ClickMarket", rows: attachCurrency(clickmarketRes.data ?? []) },
      { network: "Coliscod Angola", rows: attachCurrency(coliscodRes.data ?? []) },
      { network: "Africod Congo", rows: attachCurrency(africodCongoRes.data ?? []) },
    ],
    // Familles Shipsen (même forme de sortie ShipsenCountryKpi) — regroupées séparément de
    // `networks` ci-dessus car leurs RPC renvoient `country`/`confirmation_rate` directement,
    // pas `country_id`/`taux_confirmation` comme ClickMarket/Coliscod/Africod Congo.
    shipsenFamily: [
      { network: "Shipsen", rows: (shipsenRes.data ?? []) as ShipsenCountryKpi[] },
      { network: "ShipLead", rows: (shipleadRes.data ?? []) as ShipsenCountryKpi[] },
      { network: "MLShipAfrica", rows: (mlshipafricaRes.data ?? []) as ShipsenCountryKpi[] },
      { network: "Ikatchiexpress", rows: (ikatchiexpressRes.data ?? []) as ShipsenCountryKpi[] },
    ],
    // Global tous marchés confondus — seul Shipsen a cette RPC dédiée aujourd'hui.
    shipsenGlobal: shipsenGlobalRes.data ?? null,
    errors,
  });
}
