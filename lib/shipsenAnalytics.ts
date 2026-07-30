import { getCanonicalCountry } from "@/lib/countries";

// Client-safe : fetch (URL relative) + résolution PURE — même séparation que lib/fieldCash.ts.
// Source : shipsen_dashboard_snapshot, alimentée par scripts/sync/sync_shipsen.py (endpoint réel
// du dashboard web Shipsen, /analytics/getTotalOrdersPaid — voir
// supabase/shipsen_dashboard_snapshot_schema.sql pour le détail et ses limites).
export interface ShipsenAnalyticsSnapshot {
  countryCode: string; // valeur brute stockée en base (ex. "Guinea", "CoteIvoire")
  countryName: string;
  flag: string;
  periodLabel: string;
  snapshotDate: string;
  confirmationRate: number | null;
  confirmedOrders: number;
  totalOrders: number;
  cancelledOrders: number;
  deliveryRate: number | null;
  totalShippings: number;
  received: number;
  paid: number;
  cancelledShipments: number;
  processed: number;
  syncedAt: string;
}

interface RawSnapshotRow {
  country: string;
  period_label: string;
  snapshot_date: string;
  confirmation_rate: number | null;
  confirmed_orders: number;
  total_orders: number;
  cancelled_orders: number;
  delivery_rate: number | null;
  total_shippings: number;
  received: number;
  paid: number;
  cancelled_shipments: number;
  processed: number;
  synced_at: string;
}

export async function fetchShipsenAnalyticsSnapshot(periodLabel = "this_month"): Promise<ShipsenAnalyticsSnapshot[]> {
  const res = await fetch(`/api/shipsen/dashboard-snapshot?periodLabel=${encodeURIComponent(periodLabel)}`);
  if (!res.ok) throw new Error(`Échec du chargement de l'instantané dashboard Shipsen (${res.status})`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);

  return ((json.snapshots ?? []) as RawSnapshotRow[]).map((row) => {
    const canonical = getCanonicalCountry(row.country);
    return {
      countryCode: row.country,
      countryName: canonical?.name ?? row.country,
      flag: canonical?.flag ?? "🌍",
      periodLabel: row.period_label,
      snapshotDate: row.snapshot_date,
      confirmationRate: row.confirmation_rate,
      confirmedOrders: row.confirmed_orders,
      totalOrders: row.total_orders,
      cancelledOrders: row.cancelled_orders,
      deliveryRate: row.delivery_rate,
      totalShippings: row.total_shippings,
      received: row.received,
      paid: row.paid,
      cancelledShipments: row.cancelled_shipments,
      processed: row.processed,
      syncedAt: row.synced_at,
    };
  });
}
