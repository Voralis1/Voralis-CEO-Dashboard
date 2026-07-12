const BASE = "https://clickmarket-backend-8scjo.ondigitalocean.app/api";

let _token: string | null = null;
let _tokenIssuedAt = 0;
const TOKEN_MAX_AGE_MS = 20 * 60 * 1000; // reconnect every 20 min out of caution

interface ClickMarketCountry {
  id: number;
  name: string;
  currency: string;
}

async function login(): Promise<{ token: string; countries: ClickMarketCountry[] }> {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      email: process.env.CLICKMARKET_EMAIL,
      password: process.env.CLICKMARKET_PASSWORD,
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`ClickMarket login failed: ${res.status}`);

  const data = await res.json();
  return { token: data.token, countries: data.countries ?? [] };
}

async function getToken(): Promise<string> {
  if (_token && Date.now() - _tokenIssuedAt < TOKEN_MAX_AGE_MS) return _token;

  const { token } = await login();
  _token = token;
  _tokenIssuedAt = Date.now();
  return token;
}

export async function getClickMarketCountries(): Promise<ClickMarketCountry[]> {
  const { countries } = await login();
  return countries;
}

export async function fetchClickMarketOrdersPage(
  country: ClickMarketCountry,
  page: number,
  perPage = 100
) {
  const doFetch = async (token: string) =>
    fetch(
      `${BASE}/orders-paginated?per_page=${perPage}&page=${page}&orders_type=orders`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "X-Selected-Country": JSON.stringify(country),
        },
        cache: "no-store",
      }
    );

  let token = await getToken();
  let res = await doFetch(token);

  if (res.status === 401) {
    // Token revoked/expired server-side before our local TTL — force a fresh login once.
    _token = null;
    token = await getToken();
    res = await doFetch(token);
  }

  if (!res.ok) throw new Error(`ClickMarket fetch failed: ${res.status}`);
  return res.json();
}
