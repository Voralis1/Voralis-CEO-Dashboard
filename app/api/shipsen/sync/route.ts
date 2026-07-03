import {
  fetchAllOrders,
  SHIPSEN_WAREHOUSES,
  type NormalizedShipsenOrder,
  type ShipsenWarehouseConfig,
} from "@/lib/shipsen";
import { supabaseAdmin } from "@/lib/supabase/server";

const UPSERT_BATCH_SIZE = 500;

async function upsertOrders(rows: NormalizedShipsenOrder[]) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from("shipsen_orders")
      .upsert(batch, { onConflict: "mongo_id" });

    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  }
}

async function syncWarehouse(warehouse: ShipsenWarehouseConfig, full: boolean) {
  if (full) {
    const orders = await fetchAllOrders(warehouse.warehouseId);
    await upsertOrders(orders);
    return { country: warehouse.country, mode: "full", synced: orders.length };
  }

  // Incremental: read what we already have for this warehouse, then stop paginating
  // as soon as a whole page is already known and unchanged. This assumes Shipsen
  // returns orders newest-first (matches every sample seen so far); if that's ever
  // wrong, the worst case is just a full re-scan since shouldStopAtPage never skips
  // pages, it only decides when to stop reading further ones.
  const { data: existingRows, error } = await supabaseAdmin
    .from("shipsen_orders")
    .select("order_id, updated_at")
    .eq("warehouse_id", warehouse.warehouseId);

  if (error) throw new Error(`Failed to read existing shipsen_orders: ${error.message}`);

  const knownUpdatedAt = new Map((existingRows ?? []).map((r) => [r.order_id, r.updated_at]));

  const orders = await fetchAllOrders(warehouse.warehouseId, {
    shouldStopAtPage: (pageOrders) =>
      pageOrders.length > 0 &&
      pageOrders.every((o) => knownUpdatedAt.get(o.order_id) === o.updated_at),
  });

  await upsertOrders(orders);
  return { country: warehouse.country, mode: "incremental", synced: orders.length };
}

async function runSync(request: Request) {
  const { searchParams } = new URL(request.url);
  const full = searchParams.get("mode") === "full";

  const results = [];
  for (const warehouse of SHIPSEN_WAREHOUSES) {
    try {
      results.push(await syncWarehouse(warehouse, full));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ country: warehouse.country, error: message });
    }
  }

  return Response.json({ results });
}

// POST: manual trigger (e.g. `curl -X POST .../sync?mode=full` for the first full sync).
export async function POST(request: Request) {
  return runSync(request);
}

// GET: Vercel Cron only ever issues GET requests, so the scheduled job hits this.
export async function GET(request: Request) {
  return runSync(request);
}
