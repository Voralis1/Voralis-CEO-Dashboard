import { supabase } from "./client";

// Diagnostic function
export async function diagnoseSupabaseConnection() {
  console.log("🔧 DIAGNOSING SUPABASE CONNECTION...");

  // Test 1: Try to connect
  try {
    await supabase.auth.getSession();
    console.log("   Auth session: ✅ Connected");
  } catch (e) {
    console.error("   Auth check failed:", e);
  }

  // Test 2: Check if meta_ads_by_country table exists and has data
  console.log("   Testing meta_ads_by_country table...");
  const { error: metaError, count, data: sampleData } = await supabase
    .from("meta_ads_by_country")
    .select("*", { count: "exact" })
    .limit(5);

  if (metaError) {
    console.error("   ❌ Error querying meta_ads_by_country:", metaError.message);
    console.error("      Error code:", metaError.code);
    console.error("      Full error:", metaError);
  } else {
    console.log("   ✅ meta_ads_by_country exists, has", count, "total rows");
    if (count === 0) {
      console.warn("   ⚠️  TABLE IS EMPTY! Need to populate with data.");
    } else if (sampleData && sampleData.length > 0) {
      console.log("   📋 Sample rows:", sampleData);
      console.log("   Column names:", Object.keys(sampleData[0]));
    }
  }

  // Test 3: Check RLS policies
  console.log("   Checking RLS (Row Level Security) policies...");
  const { data: policies, error: policiesError } = await supabase
    .from("information_schema.role_table_grants")
    .select("*")
    .eq("table_name", "meta_ads_by_country");

  if (policiesError) {
    console.log("   ℹ️  Could not check RLS policies:", policiesError.message);
  } else {
    if (policies && policies.length > 0) {
      console.log("   ℹ️  RLS Policies found:", policies.length);
    } else {
      console.log("   ℹ️  No explicit RLS policies found (data might be public)");
    }
  }

  // Test 4: Direct query with authentication context
  console.log("   Testing authenticated access...");
  const { data: authData, error: authDataError } = await supabase
    .from("meta_ads_by_country")
    .select("id, country, spend, impressions, clicks, leads, date")
    .limit(1);

  if (authDataError) {
    console.error("   ❌ Authenticated query failed:", authDataError.message);
    console.error("      This might be a RLS policy issue");
  } else {
    console.log("   ✅ Authenticated query succeeded");
    if (authData && authData.length > 0) {
      console.log("   Sample authenticated row:", authData[0]);
    }
  }

  console.log("🔧 DIAGNOSIS COMPLETE\n");
}


export interface MetaAdsCountryRow {
  channel: string;
  country: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  ctr: number;
  date: string;
}

// meta_ads_by_country a désormais une ligne par (pays, canal, jour) avec une vraie colonne
// `date` renseignée (confirmé le 2026-07-06 — ce n'est plus un snapshot cumulatif). Le filtrage
// par période est donc réel : dateFrom/dateTo optionnels pour les rares appelants qui veulent
// encore tout l'historique (aucun ne devrait s'en servir sans borne désormais).
export async function fetchMetaAdsByCountry(dateFrom?: string, dateTo?: string) {
  let query = supabase
    .from("meta_ads_by_country")
    .select("channel, country, spend, impressions, clicks, leads, cpl, ctr, date");

  if (dateFrom) query = query.gte("date", dateFrom);
  if (dateTo) query = query.lte("date", dateTo);

  const { data, error } = await query;

  if (error) {
    console.error("❌ Error fetching meta ads:", error);
    return [];
  }

  return (data ?? []) as MetaAdsCountryRow[];
}

export interface MetaAdsAccountRow {
  channel: string;
  account_id: string;
  account_name: string | null;
  country: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number | null;
  ctr: number | null;
  date: string;
}

// meta_ads_by_account — une ligne par (compte publicitaire, pays, canal, jour), même convention
// de filtrage par date réelle que meta_ads_by_country (voir commentaire ci-dessus).
export async function fetchMetaAdsByAccount(dateFrom?: string, dateTo?: string) {
  let query = supabase
    .from("meta_ads_by_account")
    .select("channel, account_id, account_name, country, spend, impressions, clicks, leads, cpl, ctr, date");

  if (dateFrom) query = query.gte("date", dateFrom);
  if (dateTo) query = query.lte("date", dateTo);

  const { data, error } = await query;

  if (error) {
    console.error("❌ Error fetching meta ads by account:", error);
    return [];
  }

  return (data ?? []) as MetaAdsAccountRow[];
}

export interface ClickMarketKpiRow {
  country_id: number;
  country_name: string;
  total_leads: number;
  confirmes: number;
  taux_confirmation: number | null;
  livres: number;
  taux_livraison: number | null;
  ca_livre: number;
  en_attente: number;
  annulees: number;
  rupture_stock: number;
  doublons: number;
  retournees: number;
}

export async function fetchClickMarketKpis(dateFrom: string, dateTo: string) {
  const { data, error } = await supabase.rpc("kpi_clickmarket_marche_periode", {
    date_from: dateFrom,
    date_to: dateTo,
  });

  if (error) {
    console.error("Failed to fetch ClickMarket KPIs:", error.message);
    throw error;
  }

  return (data ?? []) as ClickMarketKpiRow[];
}

export interface ColiscodKpiRow {
  country_id: number;
  country_name: string;
  total_leads: number;
  confirmes: number;
  taux_confirmation: number | null;
  livres: number;
  taux_livraison: number | null;
  ca_livre: number;
  en_attente: number;
  annulees: number;
  rupture_stock: number;
  doublons: number;
  retournees: number;
}

export async function fetchColiscodKpis(dateFrom: string, dateTo: string) {
  const { data, error } = await supabase.rpc("kpi_coliscod_marche_periode", {
    date_from: dateFrom,
    date_to: dateTo,
  });

  if (error) {
    console.error("Failed to fetch Coliscod KPIs:", error.message);
    throw error;
  }

  return (data ?? []) as ColiscodKpiRow[];
}

export interface AfricodCongoKpiRow {
  country_id: number;
  country_name: string;
  total_leads: number;
  confirmes: number;
  taux_confirmation: number | null;
  livres: number;
  taux_livraison: number | null;
  ca_livre: number;
  en_attente: number;
  annulees: number;
  rupture_stock: number;
  doublons: number;
  retournees: number;
}

export async function fetchAfricodCongoKpis(dateFrom: string, dateTo: string) {
  const { data, error } = await supabase.rpc("kpi_africod_congo_marche_periode", {
    date_from: dateFrom,
    date_to: dateTo,
  });

  if (error) {
    console.error("Failed to fetch Africod Congo KPIs:", error.message);
    throw error;
  }

  return (data ?? []) as AfricodCongoKpiRow[];
}

// Stock entrant (product-shipments / expeditions) — une ligne par (shipment, produit), lues
// telles quelles depuis les tables *_shipments / shipsen_expeditions (pas d'agrégation, page
// Stock & Inventaire). Forme commune aux 4 réseaux — voir components/inventory/ShipmentsTable.tsx.
export interface ShipmentRow {
  country: string;
  product_name: string;
  shipment_date: string | null;
  arrival_date: string | null;
  source_country: string | null;
  quantity_sent: number | null;
  quantity_arrived: number | null;
  quantity_defected: number | null;
  status: string | null;
}

async function fetchShipmentsFromTable(
  table: string,
  dateFrom?: string,
  dateTo?: string
): Promise<ShipmentRow[]> {
  let query = supabase
    .from(table)
    .select("country, product_name, shipment_date, arrival_date, source_country, quantity_sent, quantity_arrived, quantity_defected, status");

  if (dateFrom) query = query.gte("shipment_date", dateFrom);
  if (dateTo) query = query.lte("shipment_date", dateTo);

  const { data, error } = await query.order("shipment_date", { ascending: false });

  if (error) {
    console.error(`❌ Error fetching ${table}:`, error);
    return [];
  }

  return (data ?? []) as ShipmentRow[];
}

export async function fetchClickMarketShipments(dateFrom?: string, dateTo?: string) {
  return fetchShipmentsFromTable("clickmarket_shipments", dateFrom, dateTo);
}

export async function fetchColiscodShipments(dateFrom?: string, dateTo?: string) {
  return fetchShipmentsFromTable("coliscod_shipments", dateFrom, dateTo);
}

export async function fetchAfricodCongoShipments(dateFrom?: string, dateTo?: string) {
  return fetchShipmentsFromTable("africod_congo_shipments", dateFrom, dateTo);
}

export async function fetchShipsenExpeditions(dateFrom?: string, dateTo?: string) {
  return fetchShipmentsFromTable("shipsen_expeditions", dateFrom, dateTo);
}
