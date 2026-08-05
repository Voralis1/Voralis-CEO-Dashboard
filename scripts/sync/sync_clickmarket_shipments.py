"""Remplace n8n/clickmarket-shipments-sync.workflow.json (2026-08-05).

Stock entrant (expéditions fournisseur → warehouse), pas les commandes clients (voir
sync_clickmarket.py pour ça). Cadence horaire (demande CEO) pilotée directement par le `schedule`
natif de GitHub Actions — contrairement aux synchros de commandes à 5 min (peu fiables nativement,
d'où pg_cron/pg_net en externe, voir sync-clickmarket.yml), un intervalle d'1h reste dans la marge
de fiabilité normale de GitHub Actions : pas besoin de déclencheur externe ici.
"""

from __future__ import annotations

import sys

from africacod_common import login as af_login, sync_shipments
from common import require_env, supabase_upsert

BASE_URL = "https://clickmarket-backend-8scjo.ondigitalocean.app/api"
MAX_PAGES = 200  # garde-fou large — flux à faible volume, rescan complet à chaque run


def main() -> None:
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
            n = sync_shipments(
                base_url=BASE_URL,
                table="clickmarket_shipments",
                token=token,
                country={"id": country["id"], "name": country["name"], "currency": country.get("currency")},
                max_pages=MAX_PAGES,
                upsert_fn=supabase_upsert,
            )
            total += n
            print(f"[OK] {country['name']}: {n} lignes de stock entrant")
        except Exception as err:  # noqa: BLE001 — une erreur sur un pays ne doit pas arrêter les autres
            had_error = True
            print(f"[ERROR] {country['name']}: {err}", file=sys.stderr)

    print(f"[SUMMARY] shipments={total}")
    sys.exit(1 if had_error else 0)


if __name__ == "__main__":
    main()
