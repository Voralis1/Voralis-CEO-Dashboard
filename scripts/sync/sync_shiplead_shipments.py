"""Nouvelle intégration ShipLead — stock entrant (2026-08-05). Contrairement aux autres réseaux
migrés (ClickMarket/Coliscod/Africod Congo/Shipsen), ShipLead n'avait AUCUN workflow n8n pour ce
flux — /expeditions/search a été découvert et vérifié en direct le 2026-08-05 (même plateforme
backend que Shipsen, voir shipsen_family_common.py). Pas les commandes clients (voir
sync_shiplead.py pour ça, fenêtre glissante + arrêt anticipé).

Vérifié en direct : /expeditions/search ne prend PAS de filtre `warehouse` — un seul passage
paginé renvoie déjà tous les marchés, avec `warehouse.countryName` déjà en toutes lettres (ex.
"Cameroon") sur chaque expédition. Cadence horaire (même choix que les autres synchros stock,
voir sync-clickmarket-shipments.yml) pilotée directement par le `schedule` natif de GitHub Actions.
"""

from __future__ import annotations

import sys

from common import require_env, supabase_upsert
from shipsen_family_common import login as sf_login, sync_expeditions

BASE_URL = "https://api.myshiplead.com"


def resolve_country(expedition: dict) -> str | None:
    return (expedition.get("warehouse") or {}).get("countryName")


def main() -> None:
    email = require_env("SHIPLEAD_EMAIL")
    password = require_env("SHIPLEAD_PASSWORD")

    try:
        token, _ = sf_login(BASE_URL, "/users/login", email, password)
    except Exception as err:  # noqa: BLE001
        print(f"[FATAL] Login ShipLead échoué — {err}", file=sys.stderr)
        sys.exit(1)

    try:
        n = sync_expeditions(
            base_url=BASE_URL,
            table="shiplead_shipments",
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
