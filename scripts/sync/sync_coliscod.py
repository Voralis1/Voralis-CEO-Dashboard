"""Remplace n8n/coliscod-sync.workflow.json (2026-07-31).

API derrière Cloudflare (api.africacod.com) : User-Agent navigateur + retry/backoff sur 403/429,
comme dans le workflow n8n d'origine. Un seul marché sur ce compte (Angola, id=27) — codé en dur,
jamais changé depuis la création du compte.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from africacod_common import sync_country, login as af_login
from common import DEFAULT_ROLLING_WINDOW_DAYS, MAX_PAGES_PER_WAREHOUSE, require_env, supabase_prune_missing, supabase_upsert

BASE_URL = "https://api.africacod.com/api"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
PAGE_DELAY_SECONDS = 0.4  # reste sous la limite Cloudflare (~120 req), même valeur que n8n
COUNTRY = {"id": 27, "name": "Angola", "currency": "AOA"}


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
        description="Synchro Coliscod (Angola) → Supabase. Sans argument : fenêtre glissante "
        "courte. Avec --since : rattrapage historique ponctuel. Avec --full-rescan : rescan "
        "périodique de tout l'historique (voir avertissement ci-dessous)."
    )
    parser.add_argument("--since", type=str, default=None, help="AAAA-MM-JJ — rattrapage historique ponctuel.")
    parser.add_argument("--max-pages", type=int, default=None, help="Plafond de pages.")
    parser.add_argument(
        "--full-rescan",
        action="store_true",
        help="Rescan complet sans arrêt anticipé (voir avertissement 2026-07-31 dans "
        "africacod_common.py) : l'API /orders-paginated trie par order_date (date de création), "
        "jamais par updated_at — une commande créée il y a des semaines dont le statut change "
        "aujourd'hui n'est JAMAIS revue par la synchro rapide (fenêtre glissante de "
        "%d jours). À planifier à basse fréquence (ex. toutes les 3h) en plus de la synchro "
        "rapide, pour rafraîchir le statut de tout l'historique." % DEFAULT_ROLLING_WINDOW_DAYS,
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    is_backfill = args.since is not None
    disable_early_stop = is_backfill or args.full_rescan
    if args.since:
        window_start = args.since
    elif args.full_rescan:
        window_start = "2000-01-01"  # sans effet sur le filtrage (voir africacod_common.py), juste pour les logs
    else:
        window_start = (datetime.now(timezone.utc) - timedelta(days=DEFAULT_ROLLING_WINDOW_DAYS)).date().isoformat()
    max_pages = args.max_pages or (1000 if (is_backfill or args.full_rescan) else MAX_PAGES_PER_WAREHOUSE)

    if is_backfill:
        print(f"[BACKFILL] Rattrapage historique ponctuel depuis {window_start} (max_pages={max_pages}).")
    elif args.full_rescan:
        print(f"[RESCAN] Rescan complet de l'historique (max_pages={max_pages}) — rafraîchit les statuts figés.")

    email = require_env("COLISCOD_EMAIL")
    password = require_env("COLISCOD_PASSWORD")

    def relogin() -> str:
        new_token, _ = af_login(BASE_URL, email, password, user_agent=USER_AGENT)
        return new_token

    try:
        token = relogin()
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login Coliscod échoué — {err}", file=sys.stderr)
        sys.exit(1)

    try:
        n, ids = sync_country(
            base_url=BASE_URL,
            table="coliscod_leads",
            token=token,
            country=COUNTRY,
            window_start=window_start,
            max_pages=max_pages,
            map_row=map_row,
            user_agent=USER_AGENT,
            cloudflare_retry=True,
            page_delay=PAGE_DELAY_SECONDS,
            disable_early_stop=disable_early_stop,
            relogin=relogin,
            upsert_fn=supabase_upsert,
        )
        print(f"[OK] {COUNTRY['name']}: {n} leads (depuis {window_start})")
        # Nettoyage — uniquement pour un --full-rescan réussi, voir sync_clickmarket.py pour le
        # raisonnement complet.
        if args.full_rescan:
            supabase_prune_missing("coliscod_leads", "order_id", ids)
        print(f"[SUMMARY] leads={n} finished_at={datetime.now(timezone.utc).isoformat()}")
        sys.exit(0)
    except Exception as err:  # noqa: BLE001
        print(f"[ERROR] {COUNTRY['name']}: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
