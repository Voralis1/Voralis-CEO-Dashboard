"""Intégration Meta Marketing API → Supabase (2026-08-04). Remplace le workflow n8n Meta Ads
(jamais versionné dans ce repo — la synchro était figée depuis le 2026-07-19, vraisemblablement
parce que le token utilisateur classique copié dans n8n avait expiré).

⚠️ Contrairement à ClickMarket/Shipsen/ShipLead/.../Ikatchiexpress, Meta Ads est l'API OFFICIELLE
de Meta (Graph API "Marketing"), pas un endpoint reverse-engineered. Le token requis est un token
d'UTILISATEUR SYSTÈME (Business Settings → Utilisateurs système), permission `ads_read` — celui-là
n'expire jamais (vérifié en direct : `expires_at: 0`, `data_access_expires_at: 0` via
graph.facebook.com/debug_token), contrairement à un token de session utilisateur classique (le
premier token collé par le CEO avait expiré le 2026-07-31, quelques jours après génération).

Comptes publicitaires couverts (2026-08-04, dict AD_ACCOUNTS ci-dessous) : labels historiques
donnés par le CEO (correspondance avec les noms RÉELS des comptes côté Meta vérifiée en direct —
ils diffèrent, ex. act_3561072684058234 s'appelle "IKRAM ADS 01" côté Meta mais était étiqueté
"caresnesair 1" dans n8n/Supabase historiquement). On garde le label historique pour la continuité
d'affichage (meta_ads_by_account.account_name), pas le nom Meta live.

Champs Insights vérifiés en direct sur les 6 comptes (`fields=spend,impressions,clicks,actions,ctr`,
`breakdowns=country`, `level=account`, `time_increment=1`) :
  - `actions[].action_type == "lead"` est la valeur à utiliser pour les leads : vérifié
    identique à `onsite_web_lead` et `offsite_conversion.fb_pixel_lead` sur tous les comptes
    testés (aucun écart constaté) — pas de double-comptage à craindre en sommant seulement "lead".
  - `ctr` est déjà un pourcentage (ex. "12.636166" = 12.64%), même convention que les valeurs déjà
    stockées en base par n8n (pas de conversion supplémentaire).
  - `country` est un code ISO alpha-2 brut (ex. "CG", "BF", "GN") — PAS un nom résolu. C'est
    différent de ce que n8n stockait dans meta_ads_by_country (noms résolus, ex. "Angola") mais
    n8n était incohérent pays par pays (ex. "BF" jamais résolu, "CG" résolu tantôt "Congo" tantôt
    "Congo-Brazzaville" selon l'époque — cf. lib/countries.ts pour le mapping ISO2->nom canonique
    déjà utilisé partout ailleurs dans le dashboard). Ce script résout donc chaque code ISO2 vers
    le nom canonique (ISO2_TO_CANONICAL ci-dessous, même mapping que lib/countries.ts) AVANT
    d'écrire en base, pour que les nouvelles lignes soient enfin cohérentes. Un code non reconnu
    (ex. "CD" = RD Congo, hors périmètre marché — vu en direct avec un spend négligeable, quelques
    centimes de fuite géographique) est gardé tel quel plutôt qu'inventé.

Tables cibles (déjà existantes en prod, unique constraints vérifiées en direct par upsert-test) :
  - meta_ads_by_country (channel, country, date) — un agrégat tous-comptes par pays/jour.
  - meta_ads_by_account (channel, account_id, country, date) — le détail par compte.
Les deux sont remplies en un seul passage (un fetch par compte suffit pour les deux : le détail
par compte alimente meta_ads_by_account directement, et leur somme par (pays, date) alimente
meta_ads_by_country).

Fenêtre glissante : Meta réattribue des conversions à des jours passés pendant les ~9 jours qui
suivent (fenêtre d'attribution standard "clic 7j / vue 1j"). Contrairement aux réseaux logistiques
(fenêtre de 3 jours, cf. common.py DEFAULT_ROLLING_WINDOW_DAYS), on re-synchronise donc les 9
derniers jours à chaque exécution plutôt que 3, pour que spend/leads/cpl se stabilisent avant de
sortir de la fenêtre.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

from common import require_env, supabase_upsert

GRAPH_API_VERSION = "v21.0"
GRAPH_BASE_URL = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

# Labels historiques (n8n) — PAS les noms réels des comptes côté Meta (vérifié en direct, ils
# diffèrent). Gardés pour la continuité d'affichage de meta_ads_by_account.account_name.
AD_ACCOUNTS: dict[str, str] = {
    "act_3561072684058234": "caresnesair 1",
    "act_4048130778838600": "caresnesair 2",
    "act_2731103067267680": "caresnesair 3",
    "act_1282371456807785": "Reda",
    "act_1499484484958303": "Reda",
    "act_1655996505828767": "Newone",
}

# Même mapping que lib/countries.ts (CANONICAL_COUNTRIES) — dupliqué ici faute de pouvoir
# importer du TypeScript depuis Python. Toute nouvelle entrée ajoutée côté lib/countries.ts pour
# un marché couvert par Meta Ads doit être répercutée ici.
ISO2_TO_CANONICAL: dict[str, str] = {
    "AO": "Angola",
    "GA": "Gabon",
    "CG": "Congo",
    "ML": "Mali",
    "GN": "Guinée",
    "SN": "Sénégal",
    "CI": "Côte d'Ivoire",
    "BF": "Burkina Faso",
    "MA": "Maroc",
    "CM": "Cameroun",
    "AR": "Argentine",
}

# Fenêtre d'attribution Meta (clic 7j / vue 1j) — voir docstring du module.
ROLLING_WINDOW_DAYS = 9

INSIGHTS_FIELDS = "spend,impressions,clicks,actions,ctr"


def resolve_country(iso2: str) -> str:
    return ISO2_TO_CANONICAL.get(iso2, iso2)


def fetch_account_insights(token: str, account_id: str, since: date, until: date) -> list[dict]:
    """Une ligne par (pays, jour) pour ce compte, sur [since, until] inclus."""
    url = f"{GRAPH_BASE_URL}/{account_id}/insights"
    params = {
        "fields": INSIGHTS_FIELDS,
        "breakdowns": "country",
        "level": "account",
        "time_increment": "1",
        "time_range": f'{{"since":"{since.isoformat()}","until":"{until.isoformat()}"}}',
        "limit": "500",
        "access_token": token,
    }

    rows: list[dict] = []
    next_url: str | None = url
    next_params: dict | None = params

    while next_url:
        res = requests.get(next_url, params=next_params, timeout=30)
        body = res.json()
        if not res.ok:
            raise RuntimeError(f"GET {account_id}/insights → HTTP {res.status_code}: {str(body)[:500]}")
        rows.extend(body.get("data") or [])
        next_url = (body.get("paging") or {}).get("next")
        next_params = None  # l'URL "next" contient déjà tous les paramètres, y compris le token
        if next_url:
            time.sleep(0.3)  # égard pour le rate-limit Meta si jamais plusieurs pages

    return rows


def extract_leads(actions: list[dict] | None) -> int:
    if not actions:
        return 0
    for a in actions:
        if a.get("action_type") == "lead":
            try:
                return int(float(a.get("value", 0)))
            except (TypeError, ValueError):
                return 0
    return 0


def map_account_row(account_id: str, account_name: str, raw: dict) -> dict | None:
    iso2 = raw.get("country")
    day = raw.get("date_start")
    if not iso2 or not day:
        return None

    spend = float(raw.get("spend") or 0)
    impressions = int(float(raw.get("impressions") or 0))
    clicks = int(float(raw.get("clicks") or 0))
    leads = extract_leads(raw.get("actions"))
    ctr = float(raw["ctr"]) if raw.get("ctr") not in (None, "") else None

    return {
        "channel": "meta",
        "account_id": account_id,
        "account_name": account_name,
        "country": resolve_country(iso2),
        "date": day,
        "spend": round(spend, 2),
        "impressions": impressions,
        "clicks": clicks,
        "leads": leads,
        "cpl": round(spend / leads, 4) if leads > 0 else None,
        "ctr": round(ctr, 4) if ctr is not None else None,
    }


def aggregate_by_country(account_rows: list[dict]) -> list[dict]:
    """Somme tous les comptes par (pays, jour) pour meta_ads_by_country — cpl/ctr recalculés
    après agrégation, pas moyennés depuis les lignes par compte (ce serait faux : cpl et ctr ne
    sont pas des grandeurs additives)."""
    buckets: dict[tuple[str, str], dict] = {}
    for row in account_rows:
        key = (row["country"], row["date"])
        bucket = buckets.setdefault(
            key, {"channel": "meta", "country": row["country"], "date": row["date"], "spend": 0.0, "impressions": 0, "clicks": 0, "leads": 0}
        )
        bucket["spend"] += row["spend"]
        bucket["impressions"] += row["impressions"]
        bucket["clicks"] += row["clicks"]
        bucket["leads"] += row["leads"]

    country_rows = []
    for bucket in buckets.values():
        spend = round(bucket["spend"], 2)
        leads = bucket["leads"]
        impressions = bucket["impressions"]
        clicks = bucket["clicks"]
        country_rows.append(
            {
                "channel": "meta",
                "country": bucket["country"],
                "date": bucket["date"],
                "spend": spend,
                "impressions": impressions,
                "clicks": clicks,
                "leads": leads,
                "cpl": round(spend / leads, 4) if leads > 0 else None,
                "ctr": round(100.0 * clicks / impressions, 4) if impressions > 0 else None,
            }
        )
    return country_rows


def sync(token: str, since: date, until: date) -> tuple[int, int]:
    account_rows: list[dict] = []
    for account_id, account_name in AD_ACCOUNTS.items():
        raw_rows = fetch_account_insights(token, account_id, since, until)
        for raw in raw_rows:
            row = map_account_row(account_id, account_name, raw)
            if row is not None:
                account_rows.append(row)

    country_rows = aggregate_by_country(account_rows)

    supabase_upsert("meta_ads_by_account", account_rows, on_conflict="channel,account_id,country,date")
    supabase_upsert("meta_ads_by_country", country_rows, on_conflict="channel,country,date")

    return len(account_rows), len(country_rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchro Meta Ads → Supabase. Sans argument : fenêtre glissante de "
        f"{ROLLING_WINDOW_DAYS} jours (réattribution des conversions). --since : rattrapage "
        "historique ponctuel jusqu'à aujourd'hui."
    )
    parser.add_argument("--since", type=str, default=None, help="AAAA-MM-JJ — rattrapage historique ponctuel.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    today = datetime.now(timezone.utc).date()

    if args.since:
        since = date.fromisoformat(args.since)
        print(f"[BACKFILL] Rattrapage historique ponctuel depuis {since}.")
    else:
        since = today - timedelta(days=ROLLING_WINDOW_DAYS)

    token = require_env("META_ADS_TOKEN")

    try:
        # Meta plafonne empiriquement la taille utile d'une seule requête time_increment=1 ; on
        # découpe tout rattrapage en tranches de 30 jours par prudence (comme les autres scripts
        # de backfill de cette session), la fenêtre glissante normale (9 jours) tient en un seul appel.
        chunk_start = since
        total_account_rows = 0
        total_country_rows = 0
        while chunk_start <= today:
            chunk_end = min(chunk_start + timedelta(days=29), today)
            n_acc, n_country = sync(token, chunk_start, chunk_end)
            total_account_rows += n_acc
            total_country_rows += n_country
            chunk_start = chunk_end + timedelta(days=1)

        print(f"[OK] {total_account_rows} lignes meta_ads_by_account, {total_country_rows} lignes meta_ads_by_country (depuis {since})")
        print(f"[SUMMARY] account_rows={total_account_rows} country_rows={total_country_rows} finished_at={datetime.now(timezone.utc).isoformat()}")
        sys.exit(0)
    except Exception as err:  # noqa: BLE001
        print(f"[ERROR] {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
