// Attention à l'orthographe : "afriquecod" (français), pas "africacod" — confirmé par une
// requête réseau réelle capturée depuis manager.afriquecod.com.
const BASE = "https://api.afriquecod.com/api";
const ORIGIN = "https://manager.afriquecod.com";

// Compte séparé de Coliscod Angola (lib/coliscod.ts) — token cache dédié pour ne pas
// mélanger les sessions des deux comptes AfricaCOD.
let _token: string | null = null;
let _tokenIssuedAt = 0;
const TOKEN_MAX_AGE_MS = 20 * 60 * 1000; // reconnect every 20 min out of caution

// L'API est derrière Cloudflare (rate limit ~120 req) : un User-Agent "nu" (node-fetch,
// axios par défaut) se fait bloquer plus facilement qu'un User-Agent de navigateur.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface AfricodCongoCountry {
  id: number;
  old_id?: string;
  name: string;
  currency: string;
  currency_exchange_rate?: number;
  flag?: string;
  phone_code?: string | null;
  timezone?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// Objet complet capturé depuis une requête réseau réelle (manager.afriquecod.com) —
// on l'envoie tel quel, sans supposer quels champs le backend valide ou non.
export const AFRICOD_CONGO: AfricodCongoCountry = {
  id: 17,
  old_id: "65dfdf15de9227002ef02de4",
  name: "Congo",
  currency: "XAF",
  currency_exchange_rate: 1,
  flag: "CG",
  phone_code: null,
  timezone: "Africa/Brazzaville",
  created_at: "2024-06-29T12:44:04.000000Z",
  updated_at: "2024-06-29T12:44:04.000000Z",
  deleted_at: null,
};

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
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
    },
    body: JSON.stringify({
      email: process.env.AFRICOD_CONGO_EMAIL,
      password: process.env.AFRICOD_CONGO_PASSWORD,
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Africod Congo login failed: ${res.status}`);

  const data = await res.json();
  if (!data.token) throw new Error("Africod Congo login: no token in response");
  return data.token;
}

async function getToken(): Promise<string> {
  if (_token && Date.now() - _tokenIssuedAt < TOKEN_MAX_AGE_MS) return _token;

  const token = await login();
  _token = token;
  _tokenIssuedAt = Date.now();
  return token;
}

export async function fetchAfricodCongoOrdersPage(
  country: AfricodCongoCountry,
  page: number,
  perPage = 100
) {
  const doFetch = async (token: string) =>
    fetch(`${BASE}/orders-paginated?per_page=${perPage}&page=${page}&orders_type=orders`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
        "X-Selected-Country": JSON.stringify(country),
        Origin: ORIGIN,
        Referer: `${ORIGIN}/`,
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

  if (!res.ok) throw new Error(`Africod Congo fetch failed: ${res.status}`);
  return res.json();
}
