# Intégration Shipsen

Un workflow n8n synchronise les commandes des 4 marchés Shipsen (Mali, Guinée, Sénégal,
Côte d'Ivoire) vers Supabase toutes les 30 min. Le dashboard CEO ne lit que Supabase — il
n'appelle jamais Shipsen directement.

```text
n8n (toutes les 30 min) → login + GET /orders/search (4 warehouses) → upsert Supabase
Dashboard CEO           → lit Supabase (KPI déjà calculés)          → affiche
```

## Fichiers

- `n8n/shipsen-sync.workflow.json` — le workflow de synchro (à importer dans n8n).
- `supabase/shipsen_schema.sql` — table `shipsen_orders` + vues `shipsen_kpi_by_country` / `shipsen_kpi_global`.
- `app/api/shipsen/kpi/route.ts` — lit les vues KPI pour le front (aucune clé Shipsen ne transite côté client).
- `components/ShipsenKpiDashboard.tsx` — UI (`app/ceo/shipsen/page.tsx`).
- `lib/shipsen.ts` / `app/api/shipsen/sync/route.ts` — première version côté Next.js, basée sur
  un login `KEY`/`SECRET` (`/users/apilogin`). **Non utilisée** : l'endpoint de login réellement
  confirmé est `/users/login` (email/mot de passe), câblé dans le workflow n8n ci-dessous.

## 1. Créer le schéma Supabase

Dans Supabase → SQL Editor, exécuter `supabase/shipsen_schema.sql`.

⚠️ **Si vous avez déjà exécuté une version précédente de ce script** (celle où `order_id`
était la clé primaire) : `order_id` (l'id "lisible" de Shipsen) n'est unique que **par
warehouse**, pas entre pays — deux warehouses peuvent avoir un ordre avec le même `order_id`,
ce qui fait planter l'upsert dès qu'un même batch contient plusieurs pays (`ON CONFLICT DO
UPDATE command cannot affect row a second time`). La clé primaire est maintenant `mongo_id`
(l'`_id` Mongo, garanti unique globalement). Comme le workflow refait une synchro complète à
chaque exécution, le plus simple est de repartir propre :

```sql
drop table if exists shipsen_orders cascade;
```

puis ré-exécuter `supabase/shipsen_schema.sql` en entier, et relancer une synchro manuelle
dans n8n.

## 2. Importer le workflow n8n

1. Dans n8n : **Import from File** → `n8n/shipsen-sync.workflow.json`.
2. Ouvrir le nœud **Config** et renseigner :
   - `shipsen_email` / `shipsen_password` : les identifiants du compte Shipsen (un seul
     compte donne accès aux 4 warehouses). ⚠️ Utilisez un mot de passe à jour — si un ancien
     a été exposé en clair quelque part, changez-le côté Shipsen avant de le coller ici.
   - `supabase_url` : l'URL du projet Supabase.
   - `supabase_service_role_key` : la clé `service_role` (jamais la clé anon).
3. Activer le workflow (toggle en haut à droite). Il tourne ensuite toutes les 30 min via le
   nœud **Schedule Trigger**.

Le nœud **Code** (`Sync Shipsen → Supabase`) :

1. Se connecte une fois (`POST /users/login` avec email/mot de passe). Particularité
   Shipsen : le JWT n'est **pas** un header HTTP réel — le corps JSON de la réponse contient
   lui-même un champ imbriqué `headers.X-Auth-Token` (contrairement à ClickMarket où le
   token est directement à la racine du corps) — le code lit donc `res.headers["X-Auth-Token"]`
   dans le JSON parsé.
2. Pagine `GET /orders/search` pour les 4 warehouses avec ce même token, en se reconnectant
   automatiquement si le cycle dépasse ~4 min.
3. Aplatit chaque commande sur les colonnes de `shipsen_orders` — `country`/`currency` viennent
   de notre config `WAREHOUSES` (ex. "Mali"), pas de `o.warehouse.country` qui est un code ISO
   ("ML") incompatible avec le reste du système (frontend, vues SQL).
4. Déduplique par `mongo_id` (au cas où deux pages se chevaucheraient si des commandes arrivent
   pendant la pagination), puis upsert par lots de 500 lignes vers `POST
   {supabase_url}/rest/v1/shipsen_orders` (`Prefer: resolution=merge-duplicates,return=minimal`).
   Chaque lot est tenté indépendamment : si l'un échoue, les suivants sont quand même envoyés.

Une erreur sur un warehouse (401, timeout réseau, etc.) ou sur un lot d'upsert est isolée dans
le champ `errors` du résultat plutôt que de faire échouer le reste de la synchro — et comme le
login est automatique, plus besoin de recoller quoi que ce soit manuellement au quotidien.

## 3. Vérifier la première synchro

Après la première exécution manuelle (bouton "Execute workflow" dans n8n), vérifier dans
Supabase que `select count(*) from shipsen_orders;` correspond à peu près à la somme des
`total` retournés par Shipsen pour chaque warehouse.

## 4. Si le workflow échoue

Chaque requête (login, `/orders/search` par warehouse, upsert Supabase) capture le code HTTP
et un extrait du corps de la réponse même en cas d'erreur, et pousse un message précis dans le
champ `errors` en sortie du nœud Code — plutôt que de laisser planter tout le nœud avec un
`AxiosError` générique sans détail. Regarder `errors` en premier : il indique quelle requête a
échoué (`ALL` = login initial, un nom de pays = pagination de ce warehouse,
`SUPABASE_UPSERT` = l'envoi vers Supabase) et pourquoi.

## Notes

- Les revenus ne sont **jamais** additionnés entre pays : Mali / Sénégal / Côte d'Ivoire
  facturent en XOF, la Guinée en GNF. Seul le nombre de commandes confirmées est agrégé
  globalement (`shipsen_kpi_global.total_confirmed_orders`).
- `status = 'Confirmed'` est la seule définition de "commande confirmée" utilisée ici,
  comparée directement sur `status.name` (pas d'appel à `/status/get`).
- Pas de cron Vercel pour cette intégration : le workflow n8n est la seule source de
  synchro, pour éviter que deux mécanismes écrivent en même temps dans `shipsen_orders`.
- Ne committez jamais le vrai `shipsen_password` (ni la clé `service_role`) dans une export
  de ce workflow suivie par git — le fichier du dépôt ne doit contenir que des placeholders ;
  les vraies valeurs vivent uniquement dans le nœud **Config** de l'instance n8n.
