"""Remplace n8n/shipsen-leads-sync.workflow.json + n8n/shipsen-sync.workflow.json (2026-07-29).

À planifier via un scheduler EXTERNE toutes les 3-5 minutes (pas dans ce script — un process
Python censé tourner en boucle indéfiniment n'a pas de superviseur natif si un run plante, alors
qu'un scheduler externe relance simplement le run suivant à l'heure prévue) :

  Linux (cron)      : */3 * * * * cd /chemin/vers/voralis-ceo && /usr/bin/python3 scripts/sync/sync_shipsen.py >> /var/log/shipsen_sync.log 2>&1
  Windows (Tâches planifiées) : déclencheur "répéter toutes les 3 minutes", action = python.exe scripts\\sync\\sync_shipsen.py
  GitHub Actions    : cron "*/5 * * * *" (5 min = le minimum pratique fiable sur GitHub Actions)

Fenêtre glissante de DEFAULT_ROLLING_WINDOW_DAYS jours (pas tout l'historique) : à chaque
exécution, on re-fetch les commandes/shippings récents et on les upsert (idempotent, clé
mongo_id) — beaucoup plus léger qu'un rescan complet toutes les 3 minutes, donc plus respectueux
d'un endpoint non-officiel qui peut limiter/bannir un compte en cas de trafic jugé anormal.

⚠️ Non vérifié au moment d'écrire ce script (login Shipsen en échec avec les identifiants actuels
de .env — "Invalid credentials", à corriger côté CEO) : l'ordre de tri réel de /orders/search et
/shippings/search pour Shipsen (confirmé newest-first pour Africod Congo dans ce projet, jamais
vérifié pour Shipsen spécifiquement). L'early-stop ci-dessous suppose ce tri mais MAX_PAGES_PER_
WAREHOUSE (common.py) borne le pire cas si l'hypothèse est fausse. Une fois le login corrigé,
relancer avec LOG_LEVEL=debug et vérifier manuellement (voir fonction verify_sort_order_once, à
appeler manuellement depuis un REPL — pas dans le flux normal du script).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

import requests

from common import (
    DEFAULT_ROLLING_WINDOW_DAYS,
    MAX_PAGES_PER_WAREHOUSE,
    require_env,
    supabase_prune_missing,
    supabase_upsert,
)

SHIPSEN_BASE = "https://api.shipsen.com"
LIMIT = 100

WAREHOUSES = [
    {"country": "Mali", "currency": "XOF", "warehouse": "619ff174286e83d6aa8f60ba"},
    {"country": "Guinea", "currency": "GNF", "warehouse": "61ceeaa3d08e37d6dca5f6b9"},
    {"country": "Senegal", "currency": "XOF", "warehouse": "61cee91cd08e37d6dca5e4fb"},
    {"country": "CoteIvoire", "currency": "XOF", "warehouse": "619ed4e22c5c08be6fcfd977"},
]


def shipsen_login() -> str:
    email = require_env("SHIPSEN_EMAIL")
    password = require_env("SHIPSEN_PASSWORD")
    res = requests.post(
        f"{SHIPSEN_BASE}/users/login",
        headers={"Content-Type": "application/json;charset=utf-8"},
        json={"email": email, "password": password},
        timeout=30,
    )
    body = res.json()
    headers = body.get("headers")
    token = headers.get("X-Auth-Token") or headers.get("x-auth-token") if isinstance(headers, dict) else None
    if not res.ok or not token:
        raise RuntimeError(f"POST /users/login → HTTP {res.status_code}: {str(body)[:500]}")
    return token


def fetch_paginated(
    path: str,
    warehouse: str,
    token: str,
    window_start: datetime,
    max_pages: int = MAX_PAGES_PER_WAREHOUSE,
    disable_early_stop: bool = False,
) -> list[dict]:
    """Pagine tant qu'une page contient au moins une ligne dans la fenêtre — s'arrête tôt si une
    page entière est plus ancienne que window_start (suppose un tri newest-first, voir avertissement
    en tête de fichier), plafonné par max_pages dans tous les cas (par défaut MAX_PAGES_PER_
    WAREHOUSE — la synchro planifiée régulière ne doit JAMAIS dépasser ce plafond bas ; seul le
    rattrapage historique ponctuel et le rescan périodique (main(), options --since/--full-rescan)
    le relèvent explicitement).

    disable_early_stop (2026-07-31, même correctif que africacod_common.py après l'incident
    Africod Congo) : /orders/search et /shippings/search trient par date de COMMANDE, pas de mise
    à jour — une commande ancienne dont le statut change aujourd'hui reste à sa position d'origine
    dans le tri, jamais remontée en page 1. La synchro rapide (fenêtre glissante courte) ne la
    revoit donc jamais une fois sortie de la fenêtre. --full-rescan désactive l'arrêt anticipé pour
    revoir tout l'historique et rafraîchir les statuts figés."""
    all_results: list[dict] = []
    page = 1
    last_page = 1

    while page <= last_page and page <= max_pages:
        res = requests.get(
            f"{SHIPSEN_BASE}{path}",
            params={"warehouse": warehouse, "limit": LIMIT, "page": page},
            headers={"X-Auth-Token": token},
            timeout=30,
        )
        if not res.ok:
            raise RuntimeError(f"GET {path} (page {page}) → HTTP {res.status_code}: {res.text[:500]}")

        content = res.json().get("content") or {}
        last_page = content.get("last_page") or 1
        results = content.get("results") or []
        if not results:
            break

        all_results.extend(results)

        # Date de référence pour l'early-stop : order.date pour /orders/search, order.date niché
        # sous o.order pour /shippings/search (voir get_reference_date).
        page_dates = [get_reference_date(o, path) for o in results]
        page_dates = [d for d in page_dates if d is not None]
        if page_dates and max(page_dates) < window_start and not disable_early_stop:
            break

        page += 1

    return all_results


def get_reference_date(raw: dict, path: str) -> datetime | None:
    iso = raw.get("date") if path == "/orders/search" else (raw.get("order") or {}).get("date")
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def sync_leads(
    warehouse: dict,
    token: str,
    window_start: datetime,
    max_pages: int = MAX_PAGES_PER_WAREHOUSE,
    disable_early_stop: bool = False,
) -> tuple[int, set[str]]:
    raw_orders = fetch_paginated(
        "/orders/search", warehouse["warehouse"], token, window_start, max_pages, disable_early_stop
    )
    rows = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for o in raw_orders:
        order_date = o.get("date")
        if not order_date or datetime.fromisoformat(order_date.replace("Z", "+00:00")) < window_start:
            continue
        details = o.get("details") or []
        first_item = details[0] if details else {}
        rows.append(
            {
                "mongo_id": o.get("_id"),
                "order_id": o.get("id") or o.get("_id"),
                "country": warehouse["country"],
                "currency": warehouse["currency"],
                "warehouse_id": (o.get("warehouse") or {}).get("_id") or warehouse["warehouse"],
                "customer_name": (o.get("customer") or {}).get("fullName"),
                "customer_phone": (o.get("customer") or {}).get("phoneNormalized") or (o.get("customer") or {}).get("phone"),
                "product_name": first_item.get("productName"),
                "quantity": first_item.get("quantity"),
                "unit_price": first_item.get("unitPrice"),
                "total_price": o.get("totalPrice") or 0,
                "status_name": (o.get("status") or {}).get("name") or "Unknown",
                "order_date": order_date,
                "created_at": o.get("createdAt"),
                "updated_at": o.get("updatedAt"),
                "unreached_count": o.get("unreachedBySize"),
                "last_unreached_date": o.get("lastUnreachedDate"),
                # synced_at inclus dès le premier jour (contrairement au bug corrigé le
                # 2026-07-21 sur les workflows n8n, qui l'omettaient du payload d'upsert).
                "synced_at": now_iso,
            }
        )

    supabase_upsert("shipsen_leads", rows)
    return len(rows), {r["mongo_id"] for r in rows if r.get("mongo_id")}


def sync_shippings(
    warehouse: dict,
    token: str,
    window_start: datetime,
    max_pages: int = MAX_PAGES_PER_WAREHOUSE,
    disable_early_stop: bool = False,
) -> tuple[int, set[str]]:
    raw_shippings = fetch_paginated(
        "/shippings/search", warehouse["warehouse"], token, window_start, max_pages, disable_early_stop
    )
    rows = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for o in raw_shippings:
        order = o.get("order") or {}
        order_date = order.get("date") or order.get("createdAt")
        if not order_date or datetime.fromisoformat(order_date.replace("Z", "+00:00")) < window_start:
            continue
        details = order.get("details") or []
        first_item = details[0] if details else {}
        rows.append(
            {
                "order_id": order.get("id") or order.get("_id") or o.get("_id"),
                "mongo_id": o.get("_id"),
                "country": warehouse["country"],
                "currency": warehouse["currency"],
                "warehouse_id": o.get("warehouse") or warehouse["warehouse"],
                "customer_name": (order.get("customer") or {}).get("fullName"),
                "customer_phone": (order.get("customer") or {}).get("phoneNormalized") or (order.get("customer") or {}).get("phone"),
                "product_name": first_item.get("productName"),
                "quantity": first_item.get("quantity"),
                "unit_price": first_item.get("unitPrice"),
                "total_price": order.get("totalPrice") or 0,
                "status": o.get("status") or "unknown",
                "is_processed": bool(o.get("isProcessed")),
                "is_refunded": bool(o.get("isRefunded")),
                "source": order.get("source"),
                "tracking_number": o.get("trackingNumber"),
                "shipping_date": (o.get("date") or "")[:10] or None,
                "order_date": order_date,
                "created_at": o.get("createdAt"),
                "updated_at": o.get("updatedAt"),
                "paid_at": o.get("paidAt"),
                "processed_at": o.get("processedAt"),
                "synced_at": now_iso,
            }
        )

    supabase_upsert("shipsen_orders", rows)
    return len(rows), {r["mongo_id"] for r in rows if r.get("mongo_id")}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchro Shipsen → Supabase. Sans argument : fenêtre glissante courte, "
        "sûre pour tourner toutes les 3-5 min (comportement utilisé par GitHub Actions/pg_cron, "
        "NE PAS CHANGER). Avec --since : rattrapage historique PONCTUEL, à lancer manuellement "
        "une fois (jamais sur le scheduler régulier — voir avertissement au premier run)."
    )
    parser.add_argument(
        "--since",
        type=str,
        default=None,
        help="Date de départ du rattrapage historique, format AAAA-MM-JJ (ex. 2025-06-01). "
        "Absent = comportement par défaut (fenêtre glissante de %d jours)." % DEFAULT_ROLLING_WINDOW_DAYS,
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Plafond de pages par entrepôt (défaut : MAX_PAGES_PER_WAREHOUSE=%d, adapté à la "
        "fenêtre courte — à relever explicitement avec --since pour couvrir un an d'historique, "
        "ex. --max-pages 1000)." % MAX_PAGES_PER_WAREHOUSE,
    )
    parser.add_argument(
        "--full-rescan",
        action="store_true",
        help="Rescan complet sans arrêt anticipé (voir avertissement 2026-07-31 dans "
        "fetch_paginated) : /orders/search et /shippings/search trient par date de commande, "
        "jamais par date de mise à jour — une commande ancienne dont le statut change aujourd'hui "
        "n'est jamais revue par la synchro rapide (fenêtre glissante de %d jours). À planifier à "
        "basse fréquence (ex. toutes les 3h) en plus de la synchro rapide, pour rafraîchir le "
        "statut de tout l'historique." % DEFAULT_ROLLING_WINDOW_DAYS,
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    is_backfill = args.since is not None
    disable_early_stop = is_backfill or args.full_rescan

    if is_backfill:
        window_start = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
        max_pages = args.max_pages or 1000
        print(
            f"[BACKFILL] Rattrapage historique ponctuel depuis {args.since} "
            f"(max_pages={max_pages}/entrepôt) — NE PAS planifier ce mode toutes les 5 min, "
            f"réservé à un lancement manuel occasionnel."
        )
    elif args.full_rescan:
        window_start = datetime(2000, 1, 1, tzinfo=timezone.utc)  # assez ancien pour ne rien filtrer
        max_pages = args.max_pages or 1000
        print(f"[RESCAN] Rescan complet de l'historique (max_pages={max_pages}/entrepôt) — rafraîchit les statuts figés.")
    else:
        window_start = datetime.now(timezone.utc) - timedelta(days=DEFAULT_ROLLING_WINDOW_DAYS)
        max_pages = args.max_pages or MAX_PAGES_PER_WAREHOUSE

    try:
        token = shipsen_login()
    except Exception as err:  # noqa: BLE001 — on veut logger puis sortir proprement, pas remonter une trace complète au scheduler
        print(f"[FATAL] Login Shipsen échoué — {err}", file=sys.stderr)
        sys.exit(1)

    total_leads = 0
    total_shippings = 0
    had_error = False
    all_lead_ids: set[str] = set()
    all_shipping_ids: set[str] = set()

    for wh in WAREHOUSES:
        try:
            n, ids = sync_leads(wh, token, window_start, max_pages, disable_early_stop)
            total_leads += n
            all_lead_ids |= ids
            print(f"[OK] {wh['country']}: {n} leads (depuis {window_start.date()})")
        except Exception as err:  # noqa: BLE001 — une erreur sur un pays ne doit pas arrêter les autres
            had_error = True
            print(f"[ERROR] {wh['country']} (leads): {err}", file=sys.stderr)

        try:
            n, ids = sync_shippings(wh, token, window_start, max_pages, disable_early_stop)
            total_shippings += n
            all_shipping_ids |= ids
            print(f"[OK] {wh['country']}: {n} shippings (depuis {window_start.date()})")
        except Exception as err:  # noqa: BLE001
            had_error = True
            print(f"[ERROR] {wh['country']} (shippings): {err}", file=sys.stderr)

    # Nettoyage — uniquement pour un --full-rescan réussi (tous entrepôts confondus, sans erreur),
    # voir common.supabase_prune_missing pour le raisonnement complet (incident MLShipAfrica,
    # 2026-08-05).
    if args.full_rescan and not had_error:
        supabase_prune_missing("shipsen_leads", "mongo_id", all_lead_ids)
        supabase_prune_missing("shipsen_orders", "mongo_id", all_shipping_ids)

    print(f"[SUMMARY] leads={total_leads} shippings={total_shippings} finished_at={datetime.now(timezone.utc).isoformat()}")
    sys.exit(1 if had_error else 0)


if __name__ == "__main__":
    main()
