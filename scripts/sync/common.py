"""Helpers partagés par les scripts scripts/sync/sync_*.py — remplacement de n8n.

Pourquoi ce module existe (2026-07-29) : le CEO veut abandonner n8n (jugé peu fiable/trop de
pièces mobiles à maintenir) au profit de scripts Python autonomes, à exécuter à intervalle
rapproché (quelques minutes, "quasi temps réel") via un planificateur externe (cron / Tâches
planifiées Windows / GitHub Actions) — voir la note en tête de chaque sync_*.py pour l'exemple
de planification.

Ces 4 réseaux (ClickMarket, Coliscod, Africod Congo, Shipsen) ne sont PAS des APIs partenaires
officielles avec support/documentation — ce sont des endpoints REST trouvés en inspectant leurs
sites web respectifs (mêmes comptes/mots de passe que n8n, dans .env). Conséquence directe pour
la fréquence : passer de 30 min (n8n) à quelques minutes multiplie le trafic vers des services qui
peuvent limiter/bannir un compte en cas de trafic jugé anormal — d'où le choix d'une FENÊTRE
GLISSANTE COURTE (quelques jours) et d'un upsert idempotent (clé primaire stable, jamais de
doublon) plutôt qu'un rescan complet de l'historique à chaque exécution.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

# La console Windows par défaut (cp1252) mutile les accents des logs ("échoué" -> "�chou�") —
# critique ici puisque ces scripts sont censés tourner sans supervision, sortie redirigée vers un
# fichier de log qu'on relit après coup pour diagnostiquer un échec.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# .env vit à la racine du projet Next.js (voralis-ceo/.env), pas dans scripts/sync/ — mêmes
# identifiants que ceux copiés-collés à la main dans les nœuds "Config" de n8n jusqu'ici.
ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Fenêtre glissante par défaut pour toutes les synchros "temps réel" — volontairement courte
# (quelques jours, pas des mois) : suffisant pour capturer les changements de statut récents
# (confirmation, livraison, annulation) sans rescanner tout l'historique à chaque exécution.
# Chaque sync_*.py peut la surcharger si besoin via son propre argument/constante.
DEFAULT_ROLLING_WINDOW_DAYS = 3

# Garde-fou : si l'hypothèse "l'API trie du plus récent au plus ancien" s'avère fausse pour un
# réseau donné (non vérifié pour Shipsen au moment d'écrire ce module — voir sync_shipsen.py),
# on ne veut JAMAIS paginer indéfiniment toutes les 3 minutes. Ce plafond borne le pire cas :
# on rate potentiellement des lignes très anciennes rentrées dans la fenêtre par erreur de tri,
# mais on ne met jamais l'API en danger de rate-limit par une pagination sans fin.
MAX_PAGES_PER_WAREHOUSE = 50


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"[FATAL] Variable d'environnement manquante ou vide : {name} (voir .env)", file=sys.stderr)
        sys.exit(1)
    return value


def supabase_upsert(table: str, rows: list[dict], on_conflict: str | None = None) -> None:
    """Upsert idempotent vers Supabase (PostgREST) — mêmes en-têtes que les workflows n8n
    existants (Prefer: resolution=merge-duplicates). Sans on_conflict, PostgREST cible la clé
    primaire de la table par défaut (mongo_id pour shipsen_leads/shipsen_orders)."""
    if not rows:
        return
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("[FATAL] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env", file=sys.stderr)
        sys.exit(1)

    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"

    # Par lots de 500, comme les workflows n8n — évite un corps de requête trop volumineux et
    # isole les échecs (un lot en erreur n'empêche pas les suivants).
    batch_size = 500
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        res = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json=batch,
            timeout=30,
        )
        if not res.ok:
            print(f"[ERROR] Upsert {table} (lot {i}-{i + len(batch)}) → HTTP {res.status_code}: {res.text[:500]}", file=sys.stderr)


def supabase_prune_missing(table: str, pk_column: str, live_ids: set[str], min_retention_ratio: float = 0.8) -> int:
    """Supprime les lignes de `table` dont `pk_column` n'apparaît plus dans `live_ids` — le
    complément de supabase_upsert (qui n'ajoute/ne met à jour que, jamais ne supprime). À
    n'appeler QU'après un scan complet réussi (--full-rescan, disable_early_stop=True, aucun
    plafond de pages limitant réellement atteint) : c'est le seul cas où live_ids représente
    fidèlement TOUT ce qui existe côté source, donc où "absent de live_ids" veut vraiment dire
    "supprimé/fusionné côté source" plutôt que "juste hors de la fenêtre scannée".

    Incident réel (2026-08-05, MLShipAfrica) : 92 lignes "Unreached" disparues du côté source
    (probablement nettoyées par la plateforme) sont restées en base indéfiniment, gonflant les
    totaux affichés (372 vs 352 réel sur juillet) — supabase_upsert ne les aurait jamais retirées
    de lui-même, d'où cette fonction.

    Garde-fou (même raisonnement que l'incident Africod Congo du 2026-07-31, early-stop jitter
    ayant tronqué un scan à 12086/40273 lignes) : si live_ids représente moins de
    min_retention_ratio du total actuellement en base, on ABANDONNE le nettoyage plutôt que de
    supprimer massivement des lignes valides à cause d'un scan incomplet (page cap atteint,
    timeout réseau à mi-scan, etc.) — mieux vaut une base légèrement en surplus qu'une purge
    erronée irréversible."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("[FATAL] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env", file=sys.stderr)
        sys.exit(1)

    headers = {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}
    all_ids: list[str] = []
    offset = 0
    while True:
        page_headers = {**headers, "Range": f"{offset}-{offset + 999}"}
        res = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=page_headers, params={"select": pk_column}, timeout=30)
        if not res.ok:
            print(f"[ERROR] Lecture {table} pour nettoyage (offset {offset}) → HTTP {res.status_code}: {res.text[:300]}", file=sys.stderr)
            return 0
        batch = res.json()
        if not batch:
            break
        all_ids.extend(row[pk_column] for row in batch)
        if len(batch) < 1000:
            break
        offset += 1000

    current_total = len(all_ids)
    if current_total == 0:
        return 0
    if len(live_ids) < current_total * min_retention_ratio:
        print(
            f"[SKIP PRUNE] {table}: scan complet ({len(live_ids)} lignes) < {min_retention_ratio * 100:.0f}% "
            f"de la base actuelle ({current_total}) — scan probablement incomplet, aucune suppression."
        )
        return 0

    stale = set(all_ids) - live_ids
    if not stale:
        return 0

    deleted = 0
    stale_list = list(stale)
    delete_batch_size = 200  # IDs passés dans l'URL (in.(...)) — reste sous les limites de longueur d'URL usuelles
    for i in range(0, len(stale_list), delete_batch_size):
        batch = stale_list[i : i + delete_batch_size]
        ids_param = ",".join(batch)
        res = requests.delete(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, params={pk_column: f"in.({ids_param})"}, timeout=30)
        if res.ok:
            deleted += len(batch)
        else:
            print(f"[ERROR] Suppression {table} (lot {i}-{i + len(batch)}) → HTTP {res.status_code}: {res.text[:300]}", file=sys.stderr)

    print(f"[PRUNE] {table}: {deleted} ligne(s) obsolète(s) supprimée(s) (absente(s) du scan complet).")
    return deleted
