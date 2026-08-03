"""Intégration MLShipAfrica → Supabase (2026-08-03), même famille de plateforme que Shipsen (voir
shipsen_family_common.py) : POST /api/users/login (préfixe /api, contrairement à ShipLead),
token dans body.headers["X-Auth-Token"], GET /api/orders/search + /api/shippings/search.

Différence structurelle avec Shipsen/ShipLead : PAS de découpage par entrepôt — le paramètre
`warehouse` renvoie "no orders found" quel que soit ce qu'on lui passe (testé en direct avec un
code pays ISO), alors qu'omettre le paramètre renvoie un flux global multi-pays. Un seul passage
de pagination, le pays de chaque commande se lit sur order["country"]/customer.country
(shippings) ou customer.country (orders) — pas de warehouse_id à stocker.

La réponse de login expose `content.countries` (liste de codes ISO des marchés configurés sur le
compte : CI/TG/ML/CG/BJ/TD/BF au moment d'écrire ce script) mais aucune devise — la devise n'est
donnée nulle part dans l'API, complétée ici via la zone CFA (UEMOA=XOF, CEMAC=XAF), connaissance
de domaine fiable pour ces 7 pays.

Vocabulaire audité en direct sur ~500 commandes (2026-08-03) :
  - order.status.name : Pending, Cancelled, Confirmed, Unreached, "double" (minuscule — contexte
    AfricaCOD-like malgré l'enveloppe API façon Shipsen ; doublons comptés sur ce statut, à la
    différence de Shipsen/ShipLead où "double" n'a jamais été observé).
  - shipping.status    : processed, return, "to prepare" (espace, pas underscore).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from common import DEFAULT_ROLLING_WINDOW_DAYS, MAX_PAGES_PER_WAREHOUSE, require_env, supabase_upsert
from shipsen_family_common import fetch_paginated, login as sf_login

BASE_URL = "https://api.mlshipafrica.app/api"

COUNTRY_CURRENCY = {
    "CI": "XOF",  # Côte d'Ivoire
    "TG": "XOF",  # Togo
    "ML": "XOF",  # Mali
    "CG": "XAF",  # Congo
    "BJ": "XOF",  # Bénin
    "TD": "XAF",  # Tchad
    "BF": "XOF",  # Burkina Faso
}


def get_reference_date(raw: dict, path: str) -> datetime | None:
    iso = raw.get("date") if path == "/orders/search" else (raw.get("order") or {}).get("date")
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def sync_leads(token: str, window_start: datetime, max_pages: int, disable_early_stop: bool) -> int:
    raw_orders = fetch_paginated(
        BASE_URL, "/orders/search", token, {}, window_start, max_pages,
        lambda o: get_reference_date(o, "/orders/search"), disable_early_stop,
    )
    rows = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for o in raw_orders:
        order_date = o.get("date")
        if not order_date or datetime.fromisoformat(order_date.replace("Z", "+00:00")) < window_start:
            continue
        customer = o.get("customer") or {}
        country_code = customer.get("country")
        details = o.get("details") or []
        first_item = details[0] if details else {}
        rows.append(
            {
                "mongo_id": o.get("_id"),
                "order_id": o.get("id") or o.get("_id"),
                "country": country_code or "Unknown",
                "currency": COUNTRY_CURRENCY.get(country_code, "XOF"),
                "customer_name": customer.get("fullName"),
                "customer_phone": customer.get("phoneNormalized") or customer.get("phone"),
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

    supabase_upsert("mlshipafrica_leads", rows)
    return len(rows)


def sync_shippings(token: str, window_start: datetime, max_pages: int, disable_early_stop: bool) -> int:
    raw_shippings = fetch_paginated(
        BASE_URL, "/shippings/search", token, {}, window_start, max_pages,
        lambda o: get_reference_date(o, "/shippings/search"), disable_early_stop,
    )
    rows = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for o in raw_shippings:
        order = o.get("order") or {}
        order_date = order.get("date") or order.get("createdAt")
        if not order_date or datetime.fromisoformat(order_date.replace("Z", "+00:00")) < window_start:
            continue
        country_code = o.get("country") or (order.get("customer") or {}).get("country")
        details = order.get("details") or []
        first_item = details[0] if details else {}
        rows.append(
            {
                "order_id": order.get("id") or order.get("_id") or o.get("_id"),
                "mongo_id": o.get("_id"),
                "country": country_code or "Unknown",
                "currency": COUNTRY_CURRENCY.get(country_code, "XOF"),
                "customer_name": (order.get("customer") or {}).get("fullName"),
                "customer_phone": (order.get("customer") or {}).get("phoneNormalized") or (order.get("customer") or {}).get("phone"),
                "product_name": first_item.get("name") or first_item.get("productName"),
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

    supabase_upsert("mlshipafrica_orders", rows)
    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchro MLShipAfrica → Supabase. Sans argument : fenêtre glissante courte. "
        "--since : rattrapage historique ponctuel. --full-rescan : rescan périodique complet."
    )
    parser.add_argument("--since", type=str, default=None, help="AAAA-MM-JJ — rattrapage historique ponctuel.")
    parser.add_argument("--max-pages", type=int, default=None, help="Plafond de pages.")
    parser.add_argument("--full-rescan", action="store_true", help="Rescan complet sans arrêt anticipé.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    is_backfill = args.since is not None
    disable_early_stop = is_backfill or args.full_rescan

    if is_backfill:
        window_start = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
        max_pages = args.max_pages or 1000
        print(f"[BACKFILL] Rattrapage historique ponctuel depuis {args.since} (max_pages={max_pages}).")
    elif args.full_rescan:
        window_start = datetime(2000, 1, 1, tzinfo=timezone.utc)
        max_pages = args.max_pages or 1000
        print(f"[RESCAN] Rescan complet de l'historique (max_pages={max_pages}) — rafraîchit les statuts figés.")
    else:
        window_start = datetime.now(timezone.utc) - timedelta(days=DEFAULT_ROLLING_WINDOW_DAYS)
        max_pages = args.max_pages or MAX_PAGES_PER_WAREHOUSE

    email = require_env("MLSHIPAFRICA_EMAIL")
    password = require_env("MLSHIPAFRICA_PASSWORD")

    try:
        token, _content = sf_login(BASE_URL, "/users/login", email, password)
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login MLShipAfrica échoué — {err}", file=sys.stderr)
        sys.exit(1)

    had_error = False
    total_leads = 0
    total_shippings = 0

    try:
        total_leads = sync_leads(token, window_start, max_pages, disable_early_stop)
        print(f"[OK] {total_leads} leads (depuis {window_start.date()})")
    except Exception as err:  # noqa: BLE001
        had_error = True
        print(f"[ERROR] leads: {err}", file=sys.stderr)

    try:
        total_shippings = sync_shippings(token, window_start, max_pages, disable_early_stop)
        print(f"[OK] {total_shippings} shippings (depuis {window_start.date()})")
    except Exception as err:  # noqa: BLE001
        had_error = True
        print(f"[ERROR] shippings: {err}", file=sys.stderr)

    print(f"[SUMMARY] leads={total_leads} shippings={total_shippings} finished_at={datetime.now(timezone.utc).isoformat()}")
    sys.exit(1 if had_error else 0)


if __name__ == "__main__":
    main()
