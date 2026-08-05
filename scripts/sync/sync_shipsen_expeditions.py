"""Remplace n8n/shipsen-expeditions-sync.workflow.json (2026-08-05).

Stock entrant (expéditions fournisseur → warehouse), pas les commandes/shippings clients (voir
sync_shipsen.py pour ça, fenêtre glissante + arrêt anticipé). Ce flux est à faible volume : ce
script republie l'intégralité de l'historique à chaque exécution (comme le faisait le workflow
n8n d'origine), sans fenêtre ni arrêt anticipé — upsert idempotent sur detail_id, donc sans risque
de doublon. Cadence horaire (demande CEO) pilotée directement par le `schedule` natif de GitHub
Actions : contrairement aux synchros de commandes à 5 min (peu fiables nativement, d'où le
pg_cron/pg_net externe — voir sync-shipsen.yml), un intervalle d'1h est dans la marge de fiabilité
normale de GitHub Actions, donc pas besoin de déclencheur externe ici.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone

import requests

from common import require_env, supabase_upsert

SHIPSEN_BASE = "https://api.shipsen.com"
LIMIT = 100
MAX_PAGES_PER_WAREHOUSE = 200  # garde-fou large — flux à faible volume, rescan complet à chaque run

# Un seul compte Shipsen (email/mot de passe) donne accès aux 4 warehouses — mêmes identifiants
# et mêmes warehouses que sync_shipsen.py.
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
    try:
        body = res.json()
    except ValueError:
        body = {}
    # Particularité Shipsen (même que sync_shipsen.py) : le token n'est PAS un header HTTP réel —
    # le corps JSON de la réponse contient un champ imbriqué "headers" qui porte le token.
    headers = body.get("headers")
    token = headers.get("X-Auth-Token") or headers.get("x-auth-token") if isinstance(headers, dict) else None
    if not res.ok or not token:
        raise RuntimeError(f"POST /users/login → HTTP {res.status_code}: {str(body)[:500]}")
    return token


def sync_warehouse(warehouse: dict, token: str) -> int:
    by_detail_id: dict[str, dict] = {}
    page = 1
    last_page = 1

    while page <= last_page and page <= MAX_PAGES_PER_WAREHOUSE:
        res = requests.get(
            f"{SHIPSEN_BASE}/expeditions/search",
            params={"warehouse": warehouse["warehouse"], "limit": LIMIT, "page": page},
            headers={"X-Auth-Token": token},
            timeout=30,
        )
        if not res.ok:
            raise RuntimeError(f"GET /expeditions/search (page {page}) → HTTP {res.status_code}: {res.text[:500]}")

        content = res.json().get("content") or {}
        last_page = content.get("last_page") or 1
        results = content.get("results") or []
        if not results:
            break

        now_iso = datetime.now(timezone.utc).isoformat()
        for e in results:
            country_name = (e.get("warehouse") or {}).get("countryName") or warehouse["country"]
            for detail in e.get("details") or []:
                detail_id = detail.get("_id")
                if not detail_id:
                    continue
                quantity = detail.get("quantity") or {}
                by_detail_id[detail_id] = {
                    "detail_id": detail_id,
                    "expedition_id": e.get("_id"),
                    "country": country_name,
                    "product_name": (detail.get("product") or {}).get("name") or "Inconnu",
                    "shipment_date": (e.get("date") or "")[:10] or None,
                    "arrival_date": e.get("arrivalDate"),
                    "source_country": e.get("country"),
                    "quantity_sent": quantity.get("sent"),
                    "quantity_arrived": quantity.get("received"),
                    "quantity_defected": quantity.get("defective"),
                    "status": e.get("status"),
                    "synced_at": now_iso,
                }

        page += 1

    rows = list(by_detail_id.values())
    supabase_upsert("shipsen_expeditions", rows)
    return len(rows)


def main() -> None:
    try:
        token = shipsen_login()
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login Shipsen échoué — {err}", file=sys.stderr)
        sys.exit(1)

    total = 0
    had_error = False

    for wh in WAREHOUSES:
        try:
            n = sync_warehouse(wh, token)
            total += n
            print(f"[OK] {wh['country']}: {n} lignes de stock entrant")
        except Exception as err:  # noqa: BLE001 — une erreur sur un entrepôt ne doit pas arrêter les autres
            had_error = True
            print(f"[ERROR] {wh['country']}: {err}", file=sys.stderr)

    print(f"[SUMMARY] expeditions={total} finished_at={datetime.now(timezone.utc).isoformat()}")
    sys.exit(1 if had_error else 0)


if __name__ == "__main__":
    main()
