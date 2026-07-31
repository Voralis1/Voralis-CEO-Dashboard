"""Moteur partagé pour les 3 réseaux de la famille AfricaCOD/AfriqueCOD (ClickMarket, Coliscod,
Africod Congo) — même produit en marque blanche, même forme d'API (POST /login, GET
/orders-paginated avec un en-tête X-Selected-Country) ; seules l'URL de base, la présence de
Cloudflare (retry/backoff + User-Agent navigateur) et la liste des pays diffèrent d'un compte à
l'autre. Remplace n8n/clickmarket-sync.workflow.json, n8n/coliscod-sync.workflow.json,
n8n/africod-congo-sync.workflow.json (2026-07-31).

Contrairement aux 3 workflows n8n d'origine (qui rescannaient TOUT l'historique à chaque
exécution, sans arrêt anticipé, pour ClickMarket/Coliscod — seul Africod Congo avait déjà ce
correctif depuis le 2026-07-14), ce module applique l'arrêt anticipé PARTOUT : vérifié en direct
le 2026-07-31 que ClickMarket et Coliscod trient aussi bien du plus récent au plus ancien
(page 1 = dates les plus récentes, page N = dates plus anciennes, décroissant) — même hypothèse
que celle déjà confirmée pour Africod Congo.
"""

from __future__ import annotations

import json
import time
from typing import Callable

import requests

PER_PAGE = 100


def login(
    base_url: str,
    email: str,
    password: str,
    user_agent: str | None = None,
    origin: str | None = None,
) -> tuple[str, list[dict]]:
    """POST /login — le token est TOUJOURS à la racine du corps de réponse (`body.token`) pour
    les 3 réseaux de cette famille (contrairement à Shipsen, qui le niche dans body.headers).
    countries n'est renseigné que par ClickMarket (marchés détectés automatiquement pour le
    compte) — vide pour Coliscod/Africod Congo, qui utilisent une liste de pays codée en dur
    (un seul marché par compte, jamais changé depuis la création)."""
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if user_agent:
        headers["User-Agent"] = user_agent
    if origin:
        headers["Origin"] = origin
        headers["Referer"] = f"{origin}/"

    res = requests.post(f"{base_url}/login", headers=headers, json={"email": email, "password": password}, timeout=30)
    try:
        body = res.json()
    except ValueError:
        body = {}
    token = body.get("token")
    if not res.ok or not token:
        raise RuntimeError(f"POST /login → HTTP {res.status_code}: {str(body)[:500]}")
    return token, body.get("countries") or []


def fetch_orders_page(
    base_url: str,
    token: str,
    country: dict,
    page: int,
    user_agent: str | None,
    origin: str | None,
    cloudflare_retry: bool,
    relogin: Callable[[], str] | None = None,
) -> tuple[dict, str]:
    """Retourne (data, token) — le token peut changer si une reconnexion a eu lieu (401 en cours
    de scan, voir relogin ci-dessous)."""
    attempt = 0
    relogin_attempts = 0
    while True:
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "X-Selected-Country": json.dumps(country),
        }
        if user_agent:
            headers["User-Agent"] = user_agent
        if origin:
            headers["Origin"] = origin
            headers["Referer"] = f"{origin}/"

        res = requests.get(
            f"{base_url}/orders-paginated",
            params={"per_page": PER_PAGE, "page": page, "orders_type": "leads"},
            headers=headers,
            timeout=30,
        )
        # Retry avec backoff sur 403/429 (Cloudflare / rate limit) — jusqu'à 3 tentatives.
        # Seulement pour Coliscod/Africod Congo (cloudflare_retry=True) ; ClickMarket n'a jamais
        # montré ce comportement dans le workflow n8n d'origine, pas de retry ajouté sans preuve.
        if cloudflare_retry and res.status_code in (403, 429):
            attempt += 1
            if attempt > 3:
                raise RuntimeError(
                    f"GET /orders-paginated (page {page}) → HTTP {res.status_code} après 3 tentatives: {res.text[:500]}"
                )
            time.sleep(1.5 * attempt)
            continue
        # 401 en cours de scan (2026-07-31, incident réel constaté sur Coliscod : le token expire/
        # est invalidé bien avant la fin d'un rescan complet de ~200 pages) : reconnexion et reprise
        # de la MÊME page avec le nouveau token, jusqu'à 2 fois — pas un simple retry, le token est
        # définitivement mort, retenter avec le même ne sert à rien.
        if res.status_code == 401 and relogin is not None:
            relogin_attempts += 1
            if relogin_attempts > 2:
                raise RuntimeError(
                    f"GET /orders-paginated (page {page}) → HTTP 401 persistant après reconnexion: {res.text[:500]}"
                )
            token = relogin()
            continue
        if not res.ok:
            raise RuntimeError(f"GET /orders-paginated (page {page}) → HTTP {res.status_code}: {res.text[:500]}")
        return res.json(), token


def fetch_orders_window(
    base_url: str,
    token: str,
    country: dict,
    window_start: str,  # "AAAA-MM-JJ"
    max_pages: int,
    user_agent: str | None = None,
    origin: str | None = None,
    cloudflare_retry: bool = False,
    page_delay: float = 0.0,
    disable_early_stop: bool = False,
    relogin: Callable[[], str] | None = None,
) -> list[dict]:
    """Pagine avec arrêt anticipé (tri newest-first, vérifié en direct le 2026-07-31 pour
    ClickMarket/Coliscod, le 2026-07-14 pour Africod Congo) : dès qu'une page entière est
    antérieure à window_start, tout ce qui suit l'est aussi (ordre décroissant) — on arrête sans
    rescanner tout l'historique restant, plafonné par max_pages dans tous les cas (garde-fou si
    l'hypothèse de tri s'avérait fausse un jour). Dédupliqué par order_id (une commande peut
    apparaître deux fois si elle change de statut/de position dans le tri pendant le scan — déjà
    observé en production sur Africod Congo).

    ⚠️ disable_early_stop=True (2026-07-31, incident réel) : le tri newest-first a un léger
    jitter documenté (déjà noté dans n8n/africod-congo-sync.workflow.json — "l'ordre n'est pas
    strictement monotone commande par commande"). Sur un rattrapage historique remontant à plus
    d'un an, ce jitter a suffi à produire une page entièrement composée de commandes antérieures
    à window_start alors que des pages plus loin contenaient encore des commandes plus récentes —
    arrêt anticipé prématuré constaté en production : Africod Congo n'a récupéré que 12086
    commandes sur 40273 réelles lors du premier rattrapage. Pour un usage APPELÉ UNE FOIS (backfill,
    fenêtre longue), la exhaustivité prime sur la vitesse — désactiver l'arrêt anticipé et ne
    compter que sur max_pages comme limite. Pour la synchro régulière (fenêtre courte, quelques
    jours), le risque de jitter est négligeable et l'arrêt anticipé reste activé par défaut."""
    by_order_id: dict[str, dict] = {}
    page = 1
    last_page = 1

    while page <= last_page and page <= max_pages:
        data, token = fetch_orders_page(base_url, token, country, page, user_agent, origin, cloudflare_retry, relogin)
        pagination = data.get("pagination") or {}
        last_page = pagination.get("last_page") or 1
        orders = data.get("orders") or []
        if not orders:
            break

        all_older_than_window = True
        for o in orders:
            order_date = (o.get("order_date") or "")[:10]
            if order_date and order_date >= window_start:
                all_older_than_window = False
            if o.get("order_id"):
                by_order_id[o["order_id"]] = o

        if all_older_than_window and not disable_early_stop:
            break

        page += 1
        if page_delay and page <= last_page:
            time.sleep(page_delay)

    return list(by_order_id.values())


def sync_country(
    *,
    base_url: str,
    table: str,
    token: str,
    country: dict,
    window_start: str,
    max_pages: int,
    map_row: Callable[[dict, dict], dict | None],
    user_agent: str | None = None,
    origin: str | None = None,
    cloudflare_retry: bool = False,
    page_delay: float = 0.0,
    disable_early_stop: bool = False,
    relogin: Callable[[], str] | None = None,
    upsert_fn: Callable[[str, list[dict]], None] = None,  # injecté par l'appelant (supabase_upsert)
) -> int:
    """Récupère + mappe + upsert les commandes d'un pays. map_row(order, country) -> row|None
    (None pour ignorer une commande hors fenêtre ou incomplète) — spécifique à chaque réseau,
    voir sync_clickmarket.py / sync_coliscod.py / sync_africod_congo.py. relogin (optionnel) :
    callback sans argument qui refait un login et renvoie un nouveau token, utilisé si l'API
    répond 401 en cours de scan (voir fetch_orders_page) — indispensable pour --full-rescan, dont
    la durée dépasse la durée de vie du token (incident réel constaté sur Coliscod le 2026-07-31)."""
    raw_orders = fetch_orders_window(
        base_url,
        token,
        country,
        window_start,
        max_pages,
        user_agent,
        origin,
        cloudflare_retry,
        page_delay,
        disable_early_stop,
        relogin,
    )
    rows = []
    for o in raw_orders:
        row = map_row(o, country)
        if row is not None:
            rows.append(row)
    upsert_fn(table, rows)
    return len(rows)
