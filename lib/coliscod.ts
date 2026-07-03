const BASE = "https://api.africacod.com/api";

let _token: string | null = null;
let _tokenIssuedAt = 0;
const TOKEN_MAX_AGE_MS = 20 * 60 * 1000; // reconnect every 20 min out of caution

// L'API est derrière Cloudflare (rate limit ~120 req) : un User-Agent "nu" (node-fetch,
// axios par défaut) se fait bloquer plus facilement qu'un User-Agent de navigateur.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface ColiscodCountry {
  id: number;
  name: string;
  currency: string;
}

// Marché unique pour l'instant — structure prête pour en ajouter d'autres plus tard
// (changer juste id/name/currency, comme pour ClickMarket).
export const COLISCOD_ANGOLA: ColiscodCountry = { id: 27, name: "Angola", currency: "AOA" };

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
    body: JSON.stringify({
      email: process.env.COLISCOD_EMAIL,
      password: process.env.COLISCOD_PASSWORD,
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Coliscod login failed: ${res.status}`);

  const data = await res.json();
  if (!data.token) throw new Error("Coliscod login: no token in response");
  return data.token;
}

async function getToken(): Promise<string> {
  if (_token && Date.now() - _tokenIssuedAt < TOKEN_MAX_AGE_MS) return _token;

  const token = await login();
  _token = token;
  _tokenIssuedAt = Date.now();
  return token;
}

export async function fetchColiscodOrdersPage(
  country: ColiscodCountry,
  page: number,
  perPage = 100
) {
  const doFetch = async (token: string) =>
    fetch(`${BASE}/orders-paginated?per_page=${perPage}&page=${page}&orders_type=leads`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
        "X-Selected-Country": JSON.stringify(country),
      },
      cache: "no-store",
    });

  let token = await getToken();
  let res = await doFetch(token);

  if (res.status === 401) {
    // Token révoqué/expiré côté serveur avant notre TTL local — on force un re-login une fois.
    _token = null;
    token = await getToken();
    res = await doFetch(token);
  } else if (res.status === 403 || res.status === 429) {
    // Cloudflare / rate limit — une petite pause puis un seul essai supplémentaire.
    await sleep(1500);
    res = await doFetch(token);
  }

  if (!res.ok) throw new Error(`Coliscod fetch failed: ${res.status}`);
  return res.json();
}
