"""Remplace n8n/africod-congo-sync.workflow.json (2026-07-31).

API derrière Cloudflare (api.afriquecod.com — orthographe française, pas "africacod") : User-Agent
navigateur + Origin/Referer + retry/backoff sur 403/429, comme le workflow n8n d'origine. Compte
séparé de Coliscod Angola, un seul marché (Congo, id=17) — objet complet capturé depuis une
requête réseau réelle, envoyé tel quel sans supposer quels champs le backend valide.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from africacod_common import sync_country, login as af_login
from common import DEFAULT_ROLLING_WINDOW_DAYS, MAX_PAGES_PER_WAREHOUSE, require_env, supabase_upsert

BASE_URL = "https://api.afriquecod.com/api"
ORIGIN = "https://manager.afriquecod.com"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
PAGE_DELAY_SECONDS = 0.4
COUNTRY = {
    "id": 17,
    "old_id": "65dfdf15de9227002ef02de4",
    "name": "Congo",
    "currency": "XAF",
    "currency_exchange_rate": 1,
    "flag": "CG",
    "phone_code": None,
    "timezone": "Africa/Brazzaville",
    "created_at": "2024-06-29T12:44:04.000000Z",
    "updated_at": "2024-06-29T12:44:04.000000Z",
    "deleted_at": None,
}


def map_row(o: dict, country: dict) -> dict | None:
    order_date = (o.get("order_date") or "")[:10]
    if not order_date:
        return None
    details = o.get("order_items") or []
    first_item = details[0] if details else {}
    product_name = (first_item.get("product") or {}).get("name")

    return {
        "order_id": o.get("order_id"),
        "internal_id": o.get("id"),
        "country_id": country["id"],
        "country_name": (o.get("country") or {}).get("name") or country["name"],
        "customer_name": o.get("customer_name"),
        "customer_phone": o.get("customer_phone_1"),
        "customer_city": o.get("customer_city"),
        "total_price": o.get("total_price") or 0,
        "quantity": o.get("quantity"),
        "confirmation_status": (o.get("confirmation_status") or {}).get("name"),
        "shipping_status": (o.get("shipping_status") or {}).get("name"),
        "seller_payment_status": o.get("seller_payment_status"),
        "product_name": product_name,
        "confirmation_agent": (o.get("confirmation_agent") or {}).get("username"),
        "order_date": order_date,
        "order_created_at": o.get("created_at"),
        "confirmed_at": o.get("confirmed_at"),
        "delivered_at": o.get("delivered_at"),
        "no_answer_count": o.get("no_answer_count"),
        "last_unreached_date": o.get("last_unreached_date"),
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchro Africod Congo → Supabase. Sans argument : fenêtre glissante courte. "
        "Avec --since : rattrapage historique ponctuel."
    )
    parser.add_argument("--since", type=str, default=None, help="AAAA-MM-JJ — rattrapage historique ponctuel.")
    parser.add_argument("--max-pages", type=int, default=None, help="Plafond de pages.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    is_backfill = args.since is not None
    window_start = args.since or (datetime.now(timezone.utc) - timedelta(days=DEFAULT_ROLLING_WINDOW_DAYS)).date().isoformat()
    max_pages = args.max_pages or (1000 if is_backfill else MAX_PAGES_PER_WAREHOUSE)

    if is_backfill:
        print(f"[BACKFILL] Rattrapage historique ponctuel depuis {window_start} (max_pages={max_pages}).")

    email = require_env("AFRICOD_CONGO_EMAIL")
    password = require_env("AFRICOD_CONGO_PASSWORD")

    try:
        token, _ = af_login(BASE_URL, email, password, user_agent=USER_AGENT, origin=ORIGIN)
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login Africod Congo échoué — {err}", file=sys.stderr)
        sys.exit(1)

    try:
        n = sync_country(
            base_url=BASE_URL,
            table="africod_congo_leads",
            token=token,
            country=COUNTRY,
            window_start=window_start,
            max_pages=max_pages,
            map_row=map_row,
            user_agent=USER_AGENT,
            origin=ORIGIN,
            cloudflare_retry=True,
            page_delay=PAGE_DELAY_SECONDS,
            disable_early_stop=is_backfill,
            upsert_fn=supabase_upsert,
        )
        print(f"[OK] {COUNTRY['name']}: {n} leads (depuis {window_start})")
        print(f"[SUMMARY] leads={n} finished_at={datetime.now(timezone.utc).isoformat()}")
        sys.exit(0)
    except Exception as err:  # noqa: BLE001
        print(f"[ERROR] {COUNTRY['name']}: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
