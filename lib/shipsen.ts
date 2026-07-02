import { PartnerCountryData } from "./data";

const BASE = "https://api.shipsen.com";

const COUNTRY_META: Record<string, { name: string; flag: string }> = {
  MA: { name: "Maroc", flag: "🇲🇦" },
  CI: { name: "Côte d'Ivoire", flag: "🇨🇮" },
  SN: { name: "Sénégal", flag: "🇸🇳" },
  AO: { name: "Angola", flag: "🇦🇴" },
  ML: { name: "Mali", flag: "🇲🇱" },
  GA: { name: "Gabon", flag: "🇬🇦" },
  GN: { name: "Guinée", flag: "🇬🇳" },
  CG: { name: "Congo-Brazza", flag: "🇨🇬" },
  CD: { name: "Congo-Kinshasa", flag: "🇨🇩" },
  CL: { name: "Congo-Lubumbashi", flag: "🇨🇩" },
};

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const res = await fetch(`${BASE}/users/apilogin`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify({
      key: process.env.SHIPSEN_API_KEY,
      secret: process.env.SHIPSEN_API_SECRET,
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Shipsen auth failed: ${res.status}`);

  const { token } = await res.json();
  _token = token;
  _tokenExpiry = Date.now() + 4.5 * 60 * 1000; // refresh 30s before the 5-min expiry
  return _token!;
}

interface ShipsenOrder {
  country: string;
  status: string;
  total: number;
}

export async function fetchShipsenStats(): Promise<PartnerCountryData[]> {
  const token = await getToken();

  // NOTE: Shipsen does not document a GET/stats endpoint.
  // Try /orders/apilist — adjust to the real endpoint once confirmed with Shipsen support.
  const res = await fetch(`${BASE}/orders/apilist`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "x-auth-token": token,
    },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Shipsen fetch failed: ${res.status}`);

  const orders: ShipsenOrder[] = await res.json();

  // Aggregate by country — count "confirmed" status orders and sum revenue
  const byCountry = new Map<string, { confirmedLeads: number; revenue: number }>();

  for (const order of orders) {
    const code = order.country?.toUpperCase();
    if (!code) continue;

    if (!byCountry.has(code)) byCountry.set(code, { confirmedLeads: 0, revenue: 0 });
    const entry = byCountry.get(code)!;

    // Adjust the status value to match what Shipsen actually returns
    if (order.status === "confirmed" || order.status === "delivered") {
      entry.confirmedLeads += 1;
      entry.revenue += order.total ?? 0;
    }
  }

  return Array.from(byCountry.entries())
    .map(([code, stats]) => ({
      country: COUNTRY_META[code]?.name ?? code,
      flag: COUNTRY_META[code]?.flag ?? "🌍",
      ...stats,
    }))
    .sort((a, b) => b.confirmedLeads - a.confirmedLeads);
}
