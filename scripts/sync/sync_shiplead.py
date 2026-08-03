"""Intégration ShipLead → Supabase (2026-08-03), même famille de plateforme que Shipsen (voir
shipsen_family_common.py) : POST /users/login (pas de préfixe /api, contrairement à
MLShipAfrica), token dans body.headers["X-Auth-Token"], GET /orders/search + /shippings/search.

Entrepôts récupérés DYNAMIQUEMENT depuis la réponse de login (content.warehouses) plutôt que
codés en dur comme WAREHOUSES dans sync_shipsen.py — plus robuste si le compte gagne un nouveau
marché, et évite de dupliquer une liste qui peut devenir fausse avec le temps.

Vocabulaire audité en direct sur ~200 commandes (2026-08-03) :
  - order.status.name  : Pending, Cancelled, Confirmed, Unreached, "En attente de dépot"
    (même vocabulaire que Shipsen — pas de "double" observé sur cet échantillon).
  - shipping.status    : received, cancelled, shipped, prepared, queued, reprogrammed
    (sous-ensemble du vocabulaire Shipsen : queued/received/reprogrammed/prepared/paid/
    processed/shipped/cancelled/refunded).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from common import DEFAULT_ROLLING_WINDOW_DAYS, MAX_PAGES_PER_WAREHOUSE, require_env, supabase_upsert
from shipsen_family_common import fetch_paginated, login as sf_login

BASE_URL = "https://api.myshiplead.com"


def get_reference_date(raw: dict, path: str) -> datetime | None:
    iso = raw.get("date") if path == "/orders/search" else (raw.get("order") or {}).get("date")
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def sync_leads(warehouse: dict, token: str, window_start: datetime, max_pages: int, disable_early_stop: bool) -> int:
    raw_orders = fetch_paginated(
        BASE_URL, "/orders/search", token, {"warehouse": warehouse["_id"]}, window_start, max_pages,
        lambda o: get_reference_date(o, "/orders/search"), disable_early_stop,
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
                "country": warehouse.get("country") or warehouse.get("name"),
                "currency": warehouse.get("currency"),
                "warehouse_id": warehouse["_id"],
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
                "synced_at": now_iso,
            }
        )

    supabase_upsert("shiplead_leads", rows)
    return len(rows)


def sync_shippings(warehouse: dict, token: str, window_start: datetime, max_pages: int, disable_early_stop: bool) -> int:
    raw_shippings = fetch_paginated(
        BASE_URL, "/shippings/search", token, {"warehouse": warehouse["_id"]}, window_start, max_pages,
        lambda o: get_reference_date(o, "/shippings/search"), disable_early_stop,
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
                "country": warehouse.get("country") or warehouse.get("name"),
                "currency": warehouse.get("currency"),
                "warehouse_id": warehouse["_id"],
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

    supabase_upsert("shiplead_orders", rows)
    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchro ShipLead → Supabase. Sans argument : fenêtre glissante courte, sûre "
        "pour tourner toutes les 5-10 min. --since : rattrapage historique ponctuel. "
        "--full-rescan : rescan périodique de tout l'historique (statuts figés, voir "
        "africacod_common.py pour le même problème sur la famille AfricaCOD)."
    )
    parser.add_argument("--since", type=str, default=None, help="AAAA-MM-JJ — rattrapage historique ponctuel.")
    parser.add_argument("--max-pages", type=int, default=None, help="Plafond de pages par entrepôt.")
    parser.add_argument("--full-rescan", action="store_true", help="Rescan complet sans arrêt anticipé.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    is_backfill = args.since is not None
    disable_early_stop = is_backfill or args.full_rescan

    if is_backfill:
        window_start = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
        max_pages = args.max_pages or 1000
        print(f"[BACKFILL] Rattrapage historique ponctuel depuis {args.since} (max_pages={max_pages}/entrepôt).")
    elif args.full_rescan:
        window_start = datetime(2000, 1, 1, tzinfo=timezone.utc)
        max_pages = args.max_pages or 1000
        print(f"[RESCAN] Rescan complet de l'historique (max_pages={max_pages}/entrepôt) — rafraîchit les statuts figés.")
    else:
        window_start = datetime.now(timezone.utc) - timedelta(days=DEFAULT_ROLLING_WINDOW_DAYS)
        max_pages = args.max_pages or MAX_PAGES_PER_WAREHOUSE

    email = require_env("SHIPLEAD_EMAIL")
    password = require_env("SHIPLEAD_PASSWORD")

    try:
        token, content = sf_login(BASE_URL, "/users/login", email, password)
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login ShipLead échoué — {err}", file=sys.stderr)
        sys.exit(1)

    warehouses = content.get("warehouses") or []
    if not warehouses:
        print("[FATAL] Aucun entrepôt renvoyé par /users/login — vérifier le compte ShipLead.", file=sys.stderr)
        sys.exit(1)

    total_leads = 0
    total_shippings = 0
    had_error = False

    for wh in warehouses:
        name = wh.get("name") or wh.get("_id")
        try:
            n = sync_leads(wh, token, window_start, max_pages, disable_early_stop)
            total_leads += n
            print(f"[OK] {name}: {n} leads (depuis {window_start.date()})")
        except Exception as err:  # noqa: BLE001 — une erreur sur un entrepôt ne doit pas arrêter les autres
            had_error = True
            print(f"[ERROR] {name} (leads): {err}", file=sys.stderr)

        try:
            n = sync_shippings(wh, token, window_start, max_pages, disable_early_stop)
            total_shippings += n
            print(f"[OK] {name}: {n} shippings (depuis {window_start.date()})")
        except Exception as err:  # noqa: BLE001
            had_error = True
            print(f"[ERROR] {name} (shippings): {err}", file=sys.stderr)

    print(f"[SUMMARY] leads={total_leads} shippings={total_shippings} finished_at={datetime.now(timezone.utc).isoformat()}")
    sys.exit(1 if had_error else 0)


if __name__ == "__main__":
    main()
