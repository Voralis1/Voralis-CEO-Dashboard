"""Remplace n8n/clickmarket-sync.workflow.json (2026-07-31).

Planification externe toutes les 3-5 minutes — voir sync_shipsen.py pour les exemples cron/Tâches
planifiées/GitHub Actions, identiques ici. Fenêtre glissante courte (DEFAULT_ROLLING_WINDOW_DAYS)
par défaut ; --since pour un rattrapage historique ponctuel (voir parse_args ci-dessous).

Différences avec Shipsen : API "famille AfricaCOD" (POST /login classique, token à la racine du
corps, GET /orders-paginated avec X-Selected-Country) — voir africacod_common.py pour le moteur
partagé avec Coliscod/Africod Congo. ClickMarket détecte ses marchés automatiquement depuis la
réponse de /login (`countries: [...]`) — pas de liste codée en dur comme les 2 autres réseaux,
son compte donnant accès à plusieurs pays (Gabon, Congo au moment d'écrire ce script).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from africacod_common import sync_country, login as af_login
from common import DEFAULT_ROLLING_WINDOW_DAYS, MAX_PAGES_PER_WAREHOUSE, require_env, supabase_upsert

BASE_URL = "https://clickmarket-backend-8scjo.ondigitalocean.app/api"


def map_row(o: dict, country: dict) -> dict | None:
    order_date = (o.get("order_date") or "")[:10]
    if not order_date:
        return None
    details = o.get("order_items") or []
    first_item = details[0] if details else {}
    product_name = (first_item.get("product") or {}).get("name")
    agent = o.get("confirmation_agent")
    agent_name = " ".join(filter(None, [agent.get("first_name"), agent.get("last_name")])) if agent else None

    return {
        "order_id": o.get("order_id"),
        "internal_id": o.get("id"),
        "country_id": o.get("country_id"),
        "country_name": (o.get("country") or {}).get("name") or country.get("name"),
        "customer_name": o.get("customer_name"),
        "customer_city": o.get("customer_city"),
        "total_price": o.get("total_price"),
        "quantity": o.get("quantity"),
        "confirmation_status": (o.get("confirmation_status") or {}).get("name"),
        "shipping_status": (o.get("shipping_status") or {}).get("name"),
        "seller_payment_status": o.get("seller_payment_status"),
        "product_name": product_name,
        "confirmation_agent": agent_name or None,
        "order_date": order_date,
        "order_created_at": o.get("created_at"),
        "confirmed_at": o.get("confirmed_at"),
        "delivered_at": o.get("delivered_at"),
        "no_answer_count": o.get("no_answer_count"),
        "last_unreached_date": o.get("last_unreached_date"),
        # synced_at inclus dès le premier jour (le bug corrigé le 2026-07-21 sur les workflows
        # n8n Shipsen — champ omis du payload d'upsert — ne se reproduit pas ici).
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchro ClickMarket → Supabase. Sans argument : fenêtre glissante courte, "
        "sûre pour tourner toutes les 3-5 min. Avec --since : rattrapage historique PONCTUEL, "
        "à lancer manuellement une fois."
    )
    parser.add_argument("--since", type=str, default=None, help="AAAA-MM-JJ — rattrapage historique ponctuel.")
    parser.add_argument("--max-pages", type=int, default=None, help="Plafond de pages par pays.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    is_backfill = args.since is not None
    window_start = args.since or (datetime.now(timezone.utc) - timedelta(days=DEFAULT_ROLLING_WINDOW_DAYS)).date().isoformat()
    max_pages = args.max_pages or (1000 if is_backfill else MAX_PAGES_PER_WAREHOUSE)

    if is_backfill:
        print(f"[BACKFILL] Rattrapage historique ponctuel depuis {window_start} (max_pages={max_pages}/pays).")

    email = require_env("CLICKMARKET_EMAIL")
    password = require_env("CLICKMARKET_PASSWORD")

    try:
        token, countries = af_login(BASE_URL, email, password)
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login ClickMarket échoué — {err}", file=sys.stderr)
        sys.exit(1)

    if not countries:
        print("[FATAL] Aucun marché renvoyé par /login — vérifier le compte ClickMarket.", file=sys.stderr)
        sys.exit(1)

    total = 0
    had_error = False

    for country in countries:
        try:
            n = sync_country(
                base_url=BASE_URL,
                table="clickmarket_leads",
                token=token,
                country={"id": country["id"], "name": country["name"], "currency": country.get("currency")},
                window_start=window_start,
                max_pages=max_pages,
                map_row=map_row,
                disable_early_stop=is_backfill,
                upsert_fn=supabase_upsert,
            )
            total += n
            print(f"[OK] {country['name']}: {n} leads (depuis {window_start})")
        except Exception as err:  # noqa: BLE001 — une erreur sur un pays ne doit pas arrêter les autres
            had_error = True
            print(f"[ERROR] {country['name']}: {err}", file=sys.stderr)

    print(f"[SUMMARY] leads={total} finished_at={datetime.now(timezone.utc).isoformat()}")
    sys.exit(1 if had_error else 0)


if __name__ == "__main__":
    main()
