import { supabaseAdmin } from "@/lib/supabase/server";

// Sert shipsen_dashboard_snapshot (voir supabase/shipsen_dashboard_snapshot_schema.sql) —
// alimentée par scripts/sync/sync_shipsen.py (fonction sync_analytics_snapshot), PAS par les
// workflows n8n ni par les tables shipsen_leads/shipsen_orders. Une ligne par jour par pays :
// on ne garde ici que la plus RÉCENTE par pays (l'historique complet reste en base pour audit,
// mais le dashboard CEO n'affiche que l'instantané du jour).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const periodLabel = searchParams.get("periodLabel") ?? "this_month";

  const { data, error } = await supabaseAdmin
    .from("shipsen_dashboard_snapshot")
    .select("*")
    .eq("period_label", periodLabel)
    .order("snapshot_date", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }

  // Une ligne la plus récente par pays (le upsert idempotent de sync_shipsen.py garantit déjà
  // au plus une ligne par pays/jour, mais un pays peut avoir plusieurs jours en historique).
  const latestByCountry = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
    if (!latestByCountry.has(row.country)) latestByCountry.set(row.country, row);
  }

  return Response.json({ snapshots: [...latestByCountry.values()] });
}
