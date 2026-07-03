const BASE = "https://api.shipsen.com";

// JWT expires after 5 minutes server-side. We refresh 1 minute early to stay safe.
const TOKEN_MAX_AGE_MS = 4 * 60 * 1000;

let _token: string | null = null;
let _tokenIssuedAt = 0;

export interface ShipsenWarehouseConfig {
  country: string;
  currency: string;
  warehouseId: string;
}

export const SHIPSEN_WAREHOUSES: ShipsenWarehouseConfig[] = [
  { country: "Mali", currency: "XOF", warehouseId: process.env.SHIPSEN_WAREHOUSE_MALI! },
  { country: "Guinea", currency: "GNF", warehouseId: process.env.SHIPSEN_WAREHOUSE_GUINEA! },
  { country: "Senegal", currency: "XOF", warehouseId: process.env.SHIPSEN_WAREHOUSE_SENEGAL! },
  { country: "Cote d'Ivoire", currency: "XOF", warehouseId: process.env.SHIPSEN_WAREHOUSE_CIV! },
];

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/users/apilogin`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify({
      key: process.env.SHIPSEN_KEY,
      secret: process.env.SHIPSEN_SECRET,
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Shipsen login failed: ${res.status}`);

  const data = await res.json();
  return data.token;
}

export async function getShipsenToken(): Promise<string> {
  if (_token && Date.now() - _tokenIssuedAt < TOKEN_MAX_AGE_MS) return _token;

  _token = await login();
  _tokenIssuedAt = Date.now();
  return _token;
}

interface ShipsenOrderStatus {
  _id: string;
  name: string;
  color?: string;
}

interface ShipsenWarehouse {
  _id: string;
  name: string;
  country: string;
  currency: string;
}

interface ShipsenCustomer {
  fullName?: string;
  phone?: string;
  city?: string;
  phoneNormalized?: string;
}

interface ShipsenOrderDetail {
  quantity: number;
  unitPrice: number;
  productName: string;
}

export interface ShipsenOrder {
  id: string;
  _id: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  processedAt: string | null;
  totalPrice: number;
  isProcessed: boolean;
  isRefunded: boolean;
  comment?: string;
  source?: string;
  status: ShipsenOrderStatus;
  warehouse: ShipsenWarehouse;
  customer?: ShipsenCustomer;
  details?: ShipsenOrderDetail[];
}

interface ShipsenSearchResponse {
  content: {
    results: ShipsenOrder[];
    total: number;
    per_page: number;
    current_page: number;
    last_page: number;
  };
  status: number;
}

export async function fetchOrdersPage(
  warehouseId: string,
  page: number,
  limit: number,
  token: string
): Promise<ShipsenSearchResponse> {
  const url = new URL(`${BASE}/orders/search`);
  url.searchParams.set("warehouse", warehouseId);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("page", String(page));

  const res = await fetch(url.toString(), {
    headers: { "X-Auth-Token": token },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Shipsen orders/search failed (warehouse ${warehouseId}, page ${page}): ${res.status}`
    );
  }

  return res.json();
}

export interface NormalizedShipsenOrder {
  order_id: string;
  mongo_id: string;
  country: string;
  currency: string;
  warehouse_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  product_name: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_price: number;
  status: string;
  is_processed: boolean;
  is_refunded: boolean;
  source: string | null;
  order_date: string;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  processed_at: string | null;
}

function normalizeOrder(order: ShipsenOrder): NormalizedShipsenOrder {
  const firstItem = order.details?.[0];

  return {
    order_id: order.id,
    mongo_id: order._id,
    country: order.warehouse?.country ?? "",
    currency: order.warehouse?.currency ?? "",
    warehouse_id: order.warehouse?._id ?? "",
    customer_name: order.customer?.fullName ?? null,
    customer_phone: order.customer?.phoneNormalized ?? order.customer?.phone ?? null,
    customer_city: order.customer?.city ?? null,
    product_name: firstItem?.productName ?? null,
    quantity: firstItem?.quantity ?? null,
    unit_price: firstItem?.unitPrice ?? null,
    total_price: order.totalPrice ?? 0,
    status: order.status?.name ?? "Unknown",
    is_processed: !!order.isProcessed,
    is_refunded: !!order.isRefunded,
    source: order.source ?? null,
    order_date: order.date,
    created_at: order.createdAt ?? null,
    updated_at: order.updatedAt ?? null,
    paid_at: order.paidAt ?? null,
    processed_at: order.processedAt ?? null,
  };
}

export interface FetchAllOrdersOptions {
  limit?: number;
  // Called once per page with that page's normalized orders. Return true to stop
  // paginating after this page (used for incremental sync — see the sync route).
  shouldStopAtPage?: (pageOrders: NormalizedShipsenOrder[]) => boolean;
}

export async function fetchAllOrders(
  warehouseId: string,
  options: FetchAllOrdersOptions = {}
): Promise<NormalizedShipsenOrder[]> {
  const limit = options.limit ?? 100;
  const all: NormalizedShipsenOrder[] = [];

  let token = await getShipsenToken();
  let tokenIssuedAt = Date.now();
  let page = 1;
  let lastPage = 1;

  do {
    // Defensive re-login if this cycle is eating into the 5-minute token lifetime.
    if (Date.now() - tokenIssuedAt > TOKEN_MAX_AGE_MS) {
      _token = null;
      token = await getShipsenToken();
      tokenIssuedAt = Date.now();
    }

    const res = await fetchOrdersPage(warehouseId, page, limit, token);
    lastPage = res.content.last_page;

    const pageOrders = res.content.results.map(normalizeOrder);
    all.push(...pageOrders);

    if (options.shouldStopAtPage?.(pageOrders)) break;

    page += 1;
  } while (page <= lastPage);

  return all;
}
