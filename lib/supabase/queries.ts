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


export type MarketMetrics = {
  country: string;
  spend: number;
  revenue: number;
  margin: number;
  marginPct: number;
  roasNet: number;
  deliveryRate: number;
  rto: number;
  leads: number;
  cpl: number;
};

export async function fetchMarketMetrics(
  country: string | "all" = "all",
  dateFrom: string,
  dateTo: string
): Promise<MarketMetrics[]> {
  // 1. Meta Ads spend + leads par pays
  const adsQuery = supabase
    .from("meta_ads")
    .select("country, spend, leads, cpl")
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (country !== "all") adsQuery.eq("country", country);

  // 2. Orders (revenue, delivery, RTO) par pays
  const ordersQuery = supabase
    .from("orders")
    .select("country, confirmed, delivered, returned, cash_in")
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (country !== "all") ordersQuery.eq("country", country);

  // 3. Coûts fixes par pays
  const costsQuery = supabase
    .from("cost_config")
    .select("country, cogs_pct, logistics_per_order, call_center_per_order");

  if (country !== "all") costsQuery.eq("country", country);

  const [{ data: ads }, { data: orders }, { data: costs }] = await Promise.all([
    adsQuery,
    ordersQuery,
    costsQuery,
  ]);

  if (!ads || !orders || !costs) return [];

  // Agrège par pays
  const countries = [...new Set([
    ...ads.map((r) => r.country),
    ...orders.map((r) => r.country),
  ])];

  return countries.map((c) => {
    const adRows = ads.filter((r) => r.country === c);
    const orderRows = orders.filter((r) => r.country === c);
    const costRow = costs.find((r) => r.country === c);

    const spend = adRows.reduce((s, r) => s + r.spend, 0);
    const leads = adRows.reduce((s, r) => s + r.leads, 0);
    const cpl = leads > 0 ? spend / leads : 0;

    const revenue = orderRows.reduce((s, r) => s + r.cash_in, 0);
    const confirmed = orderRows.reduce((s, r) => s + r.confirmed, 0);
    const delivered = orderRows.reduce((s, r) => s + r.delivered, 0);
    const returned = orderRows.reduce((s, r) => s + r.returned, 0);

    const cogsPct = costRow?.cogs_pct ?? 0.30;
    const logisticsCost = (costRow?.logistics_per_order ?? 2.5) * delivered;
    const callCenterCost = (costRow?.call_center_per_order ?? 0.8) * confirmed;
    const cogs = revenue * cogsPct;

    const margin = revenue - spend - cogs - logisticsCost - callCenterCost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    const roasNet = spend > 0 ? revenue / spend : 0;
    const deliveryRate = confirmed > 0 ? (delivered / confirmed) * 100 : 0;
    const rto = delivered > 0 ? (returned / delivered) * 100 : 0;

    return {
      country: c,
      spend,
      revenue,
      margin,
      marginPct: Math.round(marginPct * 10) / 10,
      roasNet: Math.round(roasNet * 10) / 10,
      deliveryRate: Math.round(deliveryRate),
      rto: Math.round(rto),
      leads,
      cpl: Math.round(cpl * 100) / 100,
    };
  });
}

export async function fetchAdSpendByCountry(dateFrom: string, dateTo: string) {
  const { data } = await supabase
    .from("meta_ads")
    .select("country, spend, impressions, clicks, leads, cpl, ctr")
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("spend", { ascending: false });

  return data ?? [];
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

export async function fetchMetaAdsByCountry(dateFrom?: string, dateTo?: string) {
  // First, get ALL data to debug
  const { data: allData, error: allError } = await supabase
    .from("meta_ads_by_country")
    .select("channel, country, spend, impressions, clicks, leads, cpl, ctr, date");

  console.log("🔍 DEBUG fetchMetaAdsByCountry START");
  console.log("   allData?.length:", allData?.length);
  console.log("   dateFrom:", dateFrom, "dateTo:", dateTo);

  if (allError) {
    console.error("❌ Error fetching meta ads:", allError);
    return [];
  }

  if (!allData || allData.length === 0) {
    console.warn("⚠️  No data in table at all");
    return [];
  }

  console.log("✅ Got", allData.length, "rows from table");

  // Check if any row has a date value
  const hasDateValues = allData.some((row) => row.date != null);
  console.log("   Rows have date values?", hasDateValues);

  // If no date values, just return all data (ignore date filter)
  if (!hasDateValues) {
    console.log("   📌 All date columns are NULL - returning all rows without date filtering");
    return allData as MetaAdsCountryRow[];
  }

  // If dates exist, filter by date range
  if (dateFrom || dateTo) {
    const filtered = (allData as MetaAdsCountryRow[]).filter((row) => {
      const rowDate = row.date ? row.date.split("T")[0] : row.date;
      const matches =
        (!dateFrom || rowDate >= dateFrom) &&
        (!dateTo || rowDate <= dateTo);
      return matches;
    });

    console.log("   After filtering by date [" + dateFrom + ", " + dateTo + "]:", filtered.length, "rows");
    return filtered;
  }

  console.log("🔍 DEBUG fetchMetaAdsByCountry END - returning", allData.length, "rows");
  return allData as MetaAdsCountryRow[];
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
