"""Nouvelle intégration MLShipAfrica — stock entrant (2026-08-05). Comme ShipLead, ce réseau
n'avait AUCUN workflow n8n pour ce flux — /expeditions/search a été découvert et vérifié en
direct le 2026-08-05 (même plateforme backend que Shipsen, voir shipsen_family_common.py). Pas
les commandes clients (voir sync_mlshipafrica.py pour ça).

Différence avec ShipLead : pas d'objet `warehouse` sur l'expédition (cohérent avec l'absence de
découpage par entrepôt déjà documentée dans sync_mlshipafrica.py) — le marché de destination est
directement `country_to` (code ISO, ex. "BF"), vérifié en direct. Cadence horaire (même choix que
les autres synchros stock) pilotée directement par le `schedule` natif de GitHub Actions.
"""

from __future__ import annotations

import sys

from common import require_env, supabase_upsert
from shipsen_family_common import login as sf_login, sync_expeditions

BASE_URL = "https://api.mlshipafrica.app/api"


def resolve_country(expedition: dict) -> str | None:
    return expedition.get("country_to")


def main() -> None:
    email = require_env("MLSHIPAFRICA_EMAIL")
    password = require_env("MLSHIPAFRICA_PASSWORD")

    try:
        token, _ = sf_login(BASE_URL, "/users/login", email, password)
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login MLShipAfrica échoué — {err}", file=sys.stderr)
        sys.exit(1)

    try:
        n = sync_expeditions(
            base_url=BASE_URL,
            table="mlshipafrica_shipments",
            token=token,
            resolve_country=resolve_country,
            upsert_fn=supabase_upsert,
        )
        print(f"[OK] {n} lignes de stock entrant")
        print(f"[SUMMARY] shipments={n}")
        sys.exit(0)
    except Exception as err:  # noqa: BLE001
        print(f"[ERROR] {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
