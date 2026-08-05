"""Remplace n8n/coliscod-shipments-sync.workflow.json (2026-08-05).

Stock entrant (expéditions fournisseur → warehouse), pas les commandes clients (voir
sync_coliscod.py pour ça). API derrière Cloudflare (api.africacod.com) : User-Agent navigateur +
retry/backoff sur 403/429, comme le workflow n8n d'origine. Un seul marché sur ce compte (Angola,
id=27). Cadence horaire (demande CEO) pilotée directement par le `schedule` natif de GitHub
Actions — voir sync_clickmarket_shipments.py pour l'explication (pas besoin de pg_cron/pg_net à
cette fréquence).
"""

from __future__ import annotations

import sys

from africacod_common import login as af_login, sync_shipments
from common import require_env, supabase_upsert

BASE_URL = "https://api.africacod.com/api"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
PAGE_DELAY_SECONDS = 0.4  # reste sous la limite Cloudflare (~120 req), même valeur que n8n
MAX_PAGES = 200  # garde-fou large — flux à faible volume, rescan complet à chaque run
COUNTRY = {"id": 27, "name": "Angola", "currency": "AOA"}


def main() -> None:
    email = require_env("COLISCOD_EMAIL")
    password = require_env("COLISCOD_PASSWORD")

    try:
        token, _ = af_login(BASE_URL, email, password, user_agent=USER_AGENT)
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login Coliscod échoué — {err}", file=sys.stderr)
        sys.exit(1)

    try:
        n = sync_shipments(
            base_url=BASE_URL,
            table="coliscod_shipments",
            token=token,
            country=COUNTRY,
            max_pages=MAX_PAGES,
            user_agent=USER_AGENT,
            cloudflare_retry=True,
            page_delay=PAGE_DELAY_SECONDS,
            upsert_fn=supabase_upsert,
        )
        print(f"[OK] {COUNTRY['name']}: {n} lignes de stock entrant")
        print(f"[SUMMARY] shipments={n}")
        sys.exit(0)
    except Exception as err:  # noqa: BLE001
        print(f"[ERROR] {COUNTRY['name']}: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
