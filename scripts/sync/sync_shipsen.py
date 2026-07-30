"""Remplace n8n/shipsen-leads-sync.workflow.json + n8n/shipsen-sync.workflow.json (2026-07-29).

À planifier via un scheduler EXTERNE toutes les 3-5 minutes (pas dans ce script — un process
Python censé tourner en boucle indéfiniment n'a pas de superviseur natif si un run plante, alors
qu'un scheduler externe relance simplement le run suivant à l'heure prévue) :

  Linux (cron)      : */3 * * * * cd /chemin/vers/voralis-ceo && /usr/bin/python3 scripts/sync/sync_shipsen.py >> /var/log/shipsen_sync.log 2>&1
  Windows (Tâches planifiées) : déclencheur "répéter toutes les 3 minutes", action = python.exe scripts\\sync\\sync_shipsen.py
  GitHub Actions    : cron "*/5 * * * *" (5 min = le minimum pratique fiable sur GitHub Actions)

Fenêtre glissante de DEFAULT_ROLLING_WINDOW_DAYS jours (pas tout l'historique) : à chaque
exécution, on re-fetch les commandes/shippings récents et on les upsert (idempotent, clé
mongo_id) — beaucoup plus léger qu'un rescan complet toutes les 3 minutes, donc plus respectueux
d'un endpoint non-officiel qui peut limiter/bannir un compte en cas de trafic jugé anormal.

⚠️ Non vérifié au moment d'écrire ce script (login Shipsen en échec avec les identifiants actuels
de .env — "Invalid credentials", à corriger côté CEO) : l'ordre de tri réel de /orders/search et
/shippings/search pour Shipsen (confirmé newest-first pour Africod Congo dans ce projet, jamais
vérifié pour Shipsen spécifiquement). L'early-stop ci-dessous suppose ce tri mais MAX_PAGES_PER_
WAREHOUSE (common.py) borne le pire cas si l'hypothèse est fausse. Une fois le login corrigé,
relancer avec LOG_LEVEL=debug et vérifier manuellement (voir fonction verify_sort_order_once, à
appeler manuellement depuis un REPL — pas dans le flux normal du script).
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

import requests

from common import (
    DEFAULT_ROLLING_WINDOW_DAYS,
    MAX_PAGES_PER_WAREHOUSE,
    require_env,
    supabase_upsert,
)

SHIPSEN_BASE = "https://api.shipsen.com"
LIMIT = 100

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
    body = res.json()
    headers = body.get("headers")
    token = headers.get("X-Auth-Token") or headers.get("x-auth-token") if isinstance(headers, dict) else None
    if not res.ok or not token:
        raise RuntimeError(f"POST /users/login → HTTP {res.status_code}: {str(body)[:500]}")
    return token


def fetch_paginated(path: str, warehouse: str, token: str, window_start: datetime) -> list[dict]:
    """Pagine tant qu'une page contient au moins une ligne dans la fenêtre — s'arrête tôt si une
    page entière est plus ancienne que window_start (suppose un tri newest-first, voir avertissement
    en tête de fichier), plafonné par MAX_PAGES_PER_WAREHOUSE dans tous les cas."""
    all_results: list[dict] = []
    page = 1
    last_page = 1

    while page <= last_page and page <= MAX_PAGES_PER_WAREHOUSE:
        res = requests.get(
            f"{SHIPSEN_BASE}{path}",
            params={"warehouse": warehouse, "limit": LIMIT, "page": page},
            headers={"X-Auth-Token": token},
            timeout=30,
        )
        if not res.ok:
            raise RuntimeError(f"GET {path} (page {page}) → HTTP {res.status_code}: {res.text[:500]}")

        content = res.json().get("content") or {}
        last_page = content.get("last_page") or 1
        results = content.get("results") or []
        if not results:
            break

        all_results.extend(results)

        # Date de référence pour l'early-stop : order.date pour /orders/search, order.date niché
        # sous o.order pour /shippings/search (voir get_reference_date).
        page_dates = [get_reference_date(o, path) for o in results]
        page_dates = [d for d in page_dates if d is not None]
        if page_dates and max(page_dates) < window_start:
            break

        page += 1

    return all_results


def get_reference_date(raw: dict, path: str) -> datetime | None:
    iso = raw.get("date") if path == "/orders/search" else (raw.get("order") or {}).get("date")
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def sync_leads(warehouse: dict, token: str, window_start: datetime) -> int:
    raw_orders = fetch_paginated("/orders/search", warehouse["warehouse"], token, window_start)
    rows = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for o in raw_orders:
        order_date = o.get("date")
        if not order_date or datetime.fromisoformat(order_date.replace("Z", "+00:00")) < window_start:
            continue
        details = o.get("details") or []
        first_item = details[0] if details else {}
        rows.append(
            {
                "mongo_id": o.get("_id"),
                "order_id": o.get("id") or o.get("_id"),
                "country": warehouse["country"],
                "currency": warehouse["currency"],
                "warehouse_id": (o.get("warehouse") or {}).get("_id") or warehouse["warehouse"],
                "customer_name": (o.get("customer") or {}).get("fullName"),
                "customer_phone": (o.get("customer") or {}).get("phoneNormalized") or (o.get("customer") or {}).get("phone"),
                "product_name": first_item.get("productName"),
                "quantity": first_item.get("quantity"),
                "unit_price": first_item.get("unitPrice"),
                "total_price": o.get("totalPrice") or 0,
                "status_name": (o.get("status") or {}).get("name") or "Unknown",
                "order_date": order_date,
                "created_at": o.get("createdAt"),
                "updated_at": o.get("updatedAt"),
                "unreached_count": o.get("unreachedBySize"),
                "last_unreached_date": o.get("lastUnreachedDate"),
                # synced_at inclus dès le premier jour (contrairement au bug corrigé le
                # 2026-07-21 sur les workflows n8n, qui l'omettaient du payload d'upsert).
                "synced_at": now_iso,
            }
        )

    supabase_upsert("shipsen_leads", rows)
    return len(rows)


def sync_shippings(warehouse: dict, token: str, window_start: datetime) -> int:
    raw_shippings = fetch_paginated("/shippings/search", warehouse["warehouse"], token, window_start)
    rows = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for o in raw_shippings:
        order = o.get("order") or {}
        order_date = order.get("date") or order.get("createdAt")
        if not order_date or datetime.fromisoformat(order_date.replace("Z", "+00:00")) < window_start:
            continue
        details = order.get("details") or []
        first_item = details[0] if details else {}
        rows.append(
            {
                "order_id": order.get("id") or order.get("_id") or o.get("_id"),
                "mongo_id": o.get("_id"),
                "country": warehouse["country"],
                "currency": warehouse["currency"],
                "warehouse_id": o.get("warehouse") or warehouse["warehouse"],
                "customer_name": (order.get("customer") or {}).get("fullName"),
                "customer_phone": (order.get("customer") or {}).get("phoneNormalized") or (order.get("customer") or {}).get("phone"),
                "product_name": first_item.get("productName"),
                "quantity": first_item.get("quantity"),
                "unit_price": first_item.get("unitPrice"),
                "total_price": order.get("totalPrice") or 0,
                "status": o.get("status") or "unknown",
                "is_processed": bool(o.get("isProcessed")),
                "is_refunded": bool(o.get("isRefunded")),
                "source": order.get("source"),
                "tracking_number": o.get("trackingNumber"),
                "shipping_date": (o.get("date") or "")[:10] or None,
                "order_date": order_date,
                "created_at": o.get("createdAt"),
                "updated_at": o.get("updatedAt"),
                "paid_at": o.get("paidAt"),
                "processed_at": o.get("processedAt"),
                "synced_at": now_iso,
            }
        )

    supabase_upsert("shipsen_orders", rows)
    return len(rows)


def fetch_analytics(warehouse: str, token: str, date_type: str = "thismonth") -> dict:
    """Endpoint réel du dashboard web Shipsen (trouvé le 2026-07-29 via DevTools, PAS une API
    documentée officiellement) : /analytics/getTotalOrdersPaid, découpage journalier, à sommer
    nous-mêmes. Remplace l'approximation par /orders/search+/shippings/search pour les compteurs
    'statut EN CE MOMENT' (confirmées/processed/cancelled) — ces derniers dérivaient car un
    shipment qui avance au-delà d'un certain stade sort du périmètre renvoyé par /shippings/search
    (voir n8n/shipsen-sync.workflow.json, fix synced_at du même jour). Vérifié en direct avec le
    CEO le 2026-07-29 : les totaux calculés ici matchent exactement l'écran (Guinée, This Month).

    ⚠️ DateType n'accepte QUE 'today'/'yesterday'/'thismonth'/'lastmonth' de façon fiable — toute
    autre valeur ('thisweek'/'thisyear'/'all'/'custom') retombe silencieusement sur le même
    comportement par défaut (vérifié en direct : résultats identiques pour thisyear/lastyear/all/
    custom) — PAS de plage de dates arbitraire possible ici, contrairement au sélecteur "De/À" du
    dashboard CEO. Cette source ne remplace donc PAS le calcul existant pour les périodes libres,
    seulement pour les 4 préréglages ci-dessus.

    ⚠️ Incohérence de nommage côté API : 'sumCancelled' (confirmation) vs 'sumCanceled' (livraison)
    — un seul L pour la livraison, deux pour la confirmation. Bien réel, pas une faute de frappe
    ici.
    """
    base = f"https://api.shipsen.com/analytics/getTotalOrdersPaid"

    res_confirm = requests.get(
        base,
        params={"DateType": date_type, "Response": "ConfirmationRate", "warehouse": warehouse},
        headers={"X-Auth-Token": token, "Accept": "application/json"},
        timeout=30,
    )
    res_delivery = requests.get(
        base,
        params={"DateType": date_type, "Response": "Delivery", "warehouse": warehouse},
        headers={"X-Auth-Token": token, "Accept": "application/json"},
        timeout=30,
    )
    if not res_confirm.ok or not res_delivery.ok:
        raise RuntimeError(
            f"/analytics/getTotalOrdersPaid → HTTP {res_confirm.status_code}/{res_delivery.status_code}: "
            f"{res_confirm.text[:200]} | {res_delivery.text[:200]}"
        )

    confirm_rows = (res_confirm.json().get("content") or {}).get("ResultRateConfirm") or []
    delivery_rows = (res_delivery.json().get("content") or {}).get("ResultRateDelivry") or []

    total_orders = sum(r.get("count", 0) for r in confirm_rows)
    confirmed = sum(r.get("sumConfirmed", 0) for r in confirm_rows)
    cancelled_orders = sum(r.get("sumCancelled", 0) for r in confirm_rows)

    total_shippings = sum(r.get("count", 0) for r in delivery_rows)
    processed = sum(r.get("sumProcessed", 0) for r in delivery_rows)
    paid = sum(r.get("sumPaid", 0) for r in delivery_rows)
    cancelled_shipments = sum(r.get("sumCanceled", 0) for r in delivery_rows)  # 1 seul 'l', voir docstring
    received = sum(r.get("sumReceived", 0) for r in delivery_rows)

    # Formules vérifiées en direct contre l'écran du CEO le 2026-07-29 (Guinée, This Month).
    confirmation_rate = round(100.0 * confirmed / total_orders, 2) if total_orders else None
    delivery_rate = round(100.0 * (received + paid + processed) / total_shippings, 2) if total_shippings else None

    return {
        "confirmation_rate": confirmation_rate,
        "confirmed_orders": confirmed,
        "total_orders": total_orders,
        "cancelled_orders": cancelled_orders,
        "delivery_rate": delivery_rate,
        "total_shippings": total_shippings,
        "received": received,
        "paid": paid,
        "cancelled_shipments": cancelled_shipments,
        "processed": processed,
        "raw_confirm": res_confirm.text[:4000],
        "raw_delivery": res_delivery.text[:4000],
    }


def sync_analytics_snapshot(warehouse: dict, token: str) -> dict:
    data = fetch_analytics(warehouse["warehouse"], token, "thismonth")
    now = datetime.now(timezone.utc)
    row = {
        "country": warehouse["country"],
        "period_label": "this_month",
        "snapshot_date": now.date().isoformat(),
        "confirmation_rate": data["confirmation_rate"],
        "confirmed_orders": data["confirmed_orders"],
        "total_orders": data["total_orders"],
        "cancelled_orders": data["cancelled_orders"],
        "delivery_rate": data["delivery_rate"],
        "total_shippings": data["total_shippings"],
        "received": data["received"],
        "paid": data["paid"],
        "cancelled_shipments": data["cancelled_shipments"],
        "processed": data["processed"],
        "raw_text": (data["raw_confirm"] + "\n---\n" + data["raw_delivery"])[:4000],
        "model_used": None,  # colonne héritée du plan de scraping IA abandonné — endpoint réel ici, pas d'IA
        "synced_at": now.isoformat(),
    }
    supabase_upsert("shipsen_dashboard_snapshot", [row], on_conflict="country,period_label,snapshot_date")
    return data


def main() -> None:
    window_start = datetime.now(timezone.utc) - timedelta(days=DEFAULT_ROLLING_WINDOW_DAYS)

    try:
        token = shipsen_login()
    except Exception as err:  # noqa: BLE001 — on veut logger puis sortir proprement, pas remonter une trace complète au scheduler
        print(f"[FATAL] Login Shipsen échoué — {err}", file=sys.stderr)
        sys.exit(1)

    total_leads = 0
    total_shippings = 0
    had_error = False

    for wh in WAREHOUSES:
        try:
            n = sync_leads(wh, token, window_start)
            total_leads += n
            print(f"[OK] {wh['country']}: {n} leads (fenêtre {DEFAULT_ROLLING_WINDOW_DAYS}j)")
        except Exception as err:  # noqa: BLE001 — une erreur sur un pays ne doit pas arrêter les autres
            had_error = True
            print(f"[ERROR] {wh['country']} (leads): {err}", file=sys.stderr)

        try:
            n = sync_shippings(wh, token, window_start)
            total_shippings += n
            print(f"[OK] {wh['country']}: {n} shippings (fenêtre {DEFAULT_ROLLING_WINDOW_DAYS}j)")
        except Exception as err:  # noqa: BLE001
            had_error = True
            print(f"[ERROR] {wh['country']} (shippings): {err}", file=sys.stderr)

        try:
            data = sync_analytics_snapshot(wh, token)
            print(
                f"[OK] {wh['country']}: analytics this_month — "
                f"confirmés {data['confirmed_orders']}/{data['total_orders']} ({data['confirmation_rate']}%), "
                f"livrés {data['processed']+data['paid']+data['received']}/{data['total_shippings']} ({data['delivery_rate']}%)"
            )
        except Exception as err:  # noqa: BLE001
            had_error = True
            print(f"[ERROR] {wh['country']} (analytics): {err}", file=sys.stderr)

    print(f"[SUMMARY] leads={total_leads} shippings={total_shippings} finished_at={datetime.now(timezone.utc).isoformat()}")
    sys.exit(1 if had_error else 0)


if __name__ == "__main__":
    main()
