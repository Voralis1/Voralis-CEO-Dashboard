import { supabaseAdmin } from "@/lib/supabase/server";

type SourceStatus = "ok" | "warning" | "error";

interface DataSourceStatus {
  id: string;
  name: string;
  status: SourceStatus;
  detail: string;
  lastSync: string;
}

async function checkTable(
  id: string,
  name: string,
  table: string,
  syncedAtColumn: string | null
): Promise<DataSourceStatus> {
  try {
    let query = supabaseAdmin.from(table).select(syncedAtColumn ?? "*", { count: "exact" });
    if (syncedAtColumn) {
      query = query.order(syncedAtColumn, { ascending: false }).limit(1);
    } else {
      query = query.limit(0);
    }

    const { data, count, error } = await query;
    if (error) return { id, name, status: "error", detail: error.message, lastSync: "—" };

    const rowCount = count ?? 0;
    const lastSync =
      syncedAtColumn && data && data.length > 0
        ? new Date((data[0] as unknown as Record<string, string>)[syncedAtColumn]).toLocaleString("fr-FR")
        : "—";

    return {
      id,
      name,
      status: rowCount > 0 ? "ok" : "warning",
      detail: rowCount > 0 ? `${rowCount.toLocaleString("fr-FR")} lignes` : "Aucune donnée synchronisée",
      lastSync,
    };
  } catch (err) {
    return {
      id,
      name,
      status: "error",
      detail: err instanceof Error ? err.message : "Erreur inconnue",
      lastSync: "—",
    };
  }
}

async function checkCrmVoralis(): Promise<DataSourceStatus> {
  try {
    const res = await fetch("https://www.voralisnatural.com/api/v1/reports/networks", {
      headers: { Authorization: `Bearer ${process.env.REPORTING_API_KEY}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return { id: "crm-voralis", name: "CRM Voralis", status: "error", detail: `HTTP ${res.status}`, lastSync: "—" };
    }

    return {
      id: "crm-voralis",
      name: "CRM Voralis",
      status: "ok",
      detail: "API accessible",
      lastSync: new Date().toLocaleString("fr-FR"),
    };
  } catch (err) {
    return {
      id: "crm-voralis",
      name: "CRM Voralis",
      status: "error",
      detail: err instanceof Error ? err.message : "Erreur inconnue",
      lastSync: "—",
    };
  }
}

export async function GET() {
  const sources = await Promise.all([
    checkTable("meta-ads", "Meta Ads", "meta_ads_by_country", null),
    checkTable("shipsen", "Shipsen", "shipsen_orders", "synced_at"),
    checkTable("coliscod", "Coliscod Angola", "coliscod_leads", "synced_at"),
    checkTable("africod-congo", "Africod Congo", "africod_congo_leads", "synced_at"),
    checkTable("clickmarket", "ClickMarket", "clickmarket_leads", "synced_at"),
    checkCrmVoralis(),
  ]);

  return Response.json({ sources });
}
