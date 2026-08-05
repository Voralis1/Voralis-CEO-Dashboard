"""Intégration Ikatchiexpress → Supabase (2026-08-04). Plateforme backend "AtlasSwift"
(seller.atlasswift.com / api.atlasswift.com) — NOUVELLE famille, distincte de Shipsen
(shipsen_family_common.py) et d'AfricaCOD (africacod_common.py) :
  - Login : POST /api/auth/login (email/password, PAS de app_name malgré ce que suggère l'erreur
    400 de /api/login, qui est une route multi-tenant différente, pas celle utilisée par le
    portail seller). Token Bearer classique, à la racine du corps (body.token) — voir aussi
    body.user.allowed_countries pour la liste des marchés du compte.
  - Un seul endpoint GET /api/seller/orders (page/per_page, meta.total/total_pages) : PAS de
    split confirmation/shipping comme les 2 autres familles — un seul champ `status`, en
    français, couvre tout le cycle de vie de la commande.
  - Devise : total_price/currency_code est déjà dans la devise LOCALE du pays de livraison
    (arrival_country) — total_price_original/currency_code_original est la devise de départ du
    catalogue produit du vendeur (non pertinente ici), total_price_in_account_currency/
    account_currency (MAD) est la devise du compte vendeur (non plus pertinente). On utilise donc
    total_price/currency_code, pas les 2 autres.

⚠️ Compte encore minuscule au moment d'écrire ce script (4 commandes de test, tri newest-first
JAMAIS vérifié faute de volume) : PAS d'arrêt anticipé implémenté (contrairement à
shipsen_family_common.py / africacod_common.py) — on reparcourt systématiquement toutes les
pages à chaque exécution. Sans risque tant que le volume reste faible ; à revoir (vérifier le tri
+ ajouter un arrêt anticipé) si le compte grossit significativement.

⚠️ Vocabulaire de `status` observé sur seulement 4 commandes (2026-08-04) : "Annulée", "À
rappeler", "Retourner" — "Confirmée"/"Livrée" ne sont que des suppositions (vocabulaire français
standard de ce type de plateforme, jamais vues en vrai faute de volume). kpi_ikatchiexpress_
marche_periode classe tout ce qui n'est PAS explicitement reconnu comme confirmé/annulé dans
"en attente" (jamais dans confirmé/livré par erreur) — à ré-auditer dès que le compte aura plus
de données réelles.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

import requests

from common import DEFAULT_ROLLING_WINDOW_DAYS, require_env, supabase_prune_missing, supabase_upsert

BASE_URL = "https://api.atlasswift.com"
PER_PAGE = 100
MAX_PAGES_SAFETY = 200  # garde-fou si le compte grossit brutalement entre deux runs


def login(email: str, password: str) -> str:
    res = requests.post(
        f"{BASE_URL}/api/auth/login",
        headers={"Content-Type": "application/json", "Accept": "application/json", "Origin": "https://seller.atlasswift.com"},
        json={"email": email, "password": password},
        timeout=30,
    )
    try:
        body = res.json()
    except ValueError:
        body = {}
    token = body.get("token")
    if not res.ok or not token:
        raise RuntimeError(f"POST /api/auth/login → HTTP {res.status_code}: {str(body)[:500]}")
    return token


def fetch_all_orders(token: str, max_pages: int = MAX_PAGES_SAFETY) -> list[dict]:
    """Pas d'arrêt anticipé (voir avertissement en tête de fichier) : reparcourt toutes les pages
    à chaque appel, plafonné par max_pages. Le volume actuel (quelques dizaines de commandes) rend
    ça négligeable en coût."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json", "Origin": "https://seller.atlasswift.com"}
    all_orders: list[dict] = []
    page = 1
    total_pages = 1

    while page <= total_pages and page <= max_pages:
        res = requests.get(
            f"{BASE_URL}/api/seller/orders", params={"page": page, "per_page": PER_PAGE}, headers=headers, timeout=30
        )
        if not res.ok:
            raise RuntimeError(f"GET /api/seller/orders (page {page}) → HTTP {res.status_code}: {res.text[:500]}")
        body = res.json()
        data = body.get("data") or []
        if not data:
            break
        all_orders.extend(data)
        meta = body.get("meta") or {}
        total_pages = meta.get("total_pages") or 1
        page += 1

    return all_orders


def map_row(o: dict) -> dict | None:
    order_id = o.get("id")
    created_at = o.get("created_at")
    if not order_id or not created_at:
        return None
    products = o.get("products") or []
    first_item = products[0] if products else {}

    return {
        "order_id": order_id,
        "seller_id": o.get("seller_id"),
        "country": o.get("arrival_country"),
        "currency": o.get("currency_code"),
        "customer_name": o.get("client_name"),
        "customer_phone": o.get("client_phone"),
        "customer_address": o.get("client_address"),
        "product_name": first_item.get("product_name") or first_item.get("name"),
        "quantity": first_item.get("quantity"),
        "unit_price": first_item.get("unit_price"),
        "total_price": o.get("total_price") or 0,
        "delivery_fee": o.get("delivery_fee") or 0,
        "status": o.get("status") or "Unknown",
        "order_date": created_at,
        "created_at": created_at,
        "updated_at": o.get("updated_at"),
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def sync(token: str, window_start: datetime, max_pages: int) -> tuple[int, set[str]]:
    raw_orders = fetch_all_orders(token, max_pages)
    rows = []
    for o in raw_orders:
        created_at = o.get("created_at")
        if not created_at:
            continue
        if datetime.fromisoformat(created_at.replace("Z", "+00:00")) < window_start:
            continue
        row = map_row(o)
        if row is not None:
            rows.append(row)

    supabase_upsert("ikatchiexpress_orders", rows)
    return len(rows), {r["order_id"] for r in rows if r.get("order_id")}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchro Ikatchiexpress → Supabase. Sans argument : fenêtre glissante courte. "
        "--since : rattrapage historique ponctuel. --full-rescan : re-parcourt tout l'historique "
        "(déjà le comportement par défaut vu l'absence d'arrêt anticipé — voir avertissement en "
        "tête de fichier — gardé pour la parité de commande avec les autres réseaux)."
    )
    parser.add_argument("--since", type=str, default=None, help="AAAA-MM-JJ — rattrapage historique ponctuel.")
    parser.add_argument("--max-pages", type=int, default=None, help="Plafond de pages.")
    parser.add_argument("--full-rescan", action="store_true", help="Sans effet supplémentaire aujourd'hui (voir avertissement).")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    is_backfill = args.since is not None

    if is_backfill:
        window_start = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
        print(f"[BACKFILL] Rattrapage historique ponctuel depuis {args.since}.")
    elif args.full_rescan:
        window_start = datetime(2000, 1, 1, tzinfo=timezone.utc)
        print("[RESCAN] Rescan complet de l'historique (déjà le comportement par défaut, voir avertissement).")
    else:
        window_start = datetime.now(timezone.utc) - timedelta(days=DEFAULT_ROLLING_WINDOW_DAYS)

    max_pages = args.max_pages or MAX_PAGES_SAFETY

    email = require_env("IKATCHIEXPRESS_EMAIL")
    password = require_env("IKATCHIEXPRESS_PASSWORD")

    try:
        token = login(email, password)
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login Ikatchiexpress échoué — {err}", file=sys.stderr)
        sys.exit(1)

    try:
        n, ids = sync(token, window_start, max_pages)
        print(f"[OK] {n} commandes (depuis {window_start.date()})")
        # Nettoyage — uniquement pour un --full-rescan (voir common.supabase_prune_missing pour
        # le raisonnement complet, incident MLShipAfrica 2026-08-05). Compte encore minuscule ici,
        # mais gardé pour la parité avec les autres réseaux.
        if args.full_rescan:
            supabase_prune_missing("ikatchiexpress_orders", "order_id", ids)
        print(f"[SUMMARY] orders={n} finished_at={datetime.now(timezone.utc).isoformat()}")
        sys.exit(0)
    except Exception as err:  # noqa: BLE001
        print(f"[ERROR] {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
