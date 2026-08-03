"""Moteur partagé pour les intégrations bâties sur la même plateforme backend que Shipsen —
ShipLead (api.myshiplead.com) et MLShipAfrica (api.mlshipafrica.app/api) : même enveloppe de
réponse ({content, status, headers}), même login (POST /users/login, token dans
body.headers["X-Auth-Token"]), mêmes endpoints paginés /orders/search + /shippings/search
(content.results/last_page), même vocabulaire de statuts (Pending/Confirmed/Cancelled/Unreached/
"En attente de dépot" côté leads — vérifié en direct le 2026-08-03).

sync_shipsen.py n'a PAS été migré vers ce module : il tourne en prod depuis fin juillet 2026,
aucune raison de toucher à du code qui marche pour un simple partage de code.

Différence structurelle entre les 2 consommateurs de ce module : ShipLead expose une liste
d'entrepôts dans la réponse de login (content.warehouses, à itérer avec le paramètre `warehouse`
comme Shipsen) ; MLShipAfrica n'a pas cette notion — un seul flux paginé global, le pays de
chaque commande se lit sur customer.country/order["country"], pas sur un warehouse.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Callable

import requests

PER_PAGE = 100


def login(base_url: str, login_path: str, email: str, password: str) -> tuple[str, dict]:
    res = requests.post(
        f"{base_url}{login_path}",
        headers={"Content-Type": "application/json;charset=utf-8", "Accept": "application/json"},
        json={"email": email, "password": password},
        timeout=30,
    )
    try:
        body = res.json()
    except ValueError:
        body = {}
    headers = body.get("headers")
    token = headers.get("X-Auth-Token") if isinstance(headers, dict) else None
    if not res.ok or not token:
        raise RuntimeError(f"POST {login_path} → HTTP {res.status_code}: {str(body)[:500]}")
    return token, body.get("content") or {}


def fetch_paginated(
    base_url: str,
    path: str,
    token: str,
    extra_params: dict,
    window_start: datetime,
    max_pages: int,
    get_reference_date: Callable[[dict], datetime | None],
    disable_early_stop: bool = False,
    page_delay: float = 0.0,
) -> list[dict]:
    """Pagine tant qu'une page contient au moins une ligne, arrêt anticipé (tri newest-first,
    vérifié en direct le 2026-08-03 pour ShipLead et MLShipAfrica) dès qu'une page entière est
    antérieure à window_start — sauf si disable_early_stop=True (rattrapage historique/rescan,
    même précaution que africacod_common.py après l'incident de jitter Africod Congo)."""
    all_results: list[dict] = []
    page = 1
    last_page = 1

    while page <= last_page and page <= max_pages:
        res = requests.get(
            f"{base_url}{path}",
            params={**extra_params, "limit": PER_PAGE, "page": page},
            headers={"X-Auth-Token": token},
            timeout=30,
        )
        if not res.ok:
            raise RuntimeError(f"GET {path} (page {page}) → HTTP {res.status_code}: {res.text[:500]}")

        content = res.json().get("content")
        if not isinstance(content, dict):
            # ex: {"content": "no orders found", "status": 404} — flux vide pour ce filtre.
            break

        last_page = content.get("last_page") or 1
        results = content.get("results") or []
        if not results:
            break

        all_results.extend(results)

        page_dates = [d for d in (get_reference_date(o) for o in results) if d is not None]
        if page_dates and max(page_dates) < window_start and not disable_early_stop:
            break

        page += 1
        if page_delay and page <= last_page:
            time.sleep(page_delay)

    return all_results
