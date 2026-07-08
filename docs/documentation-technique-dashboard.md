# Dashboard CEO Voralis — Documentation Technique

---

## 1. Stack technique

| Couche | Technologie | Version |
|---|---|---|
| Framework web | Next.js (App Router, Turbopack) | 16.2.7 |
| Bibliothèque UI | React | 19.2.4 |
| Langage | TypeScript | 5 |
| Style | Tailwind CSS | 4 |
| Base de données / Auth | Supabase (PostgreSQL + Auth + Row Level Security) | via `@supabase/supabase-js` 2.106, `@supabase/ssr` 0.12 |
| IA conversationnelle | API Anthropic Claude (modèle `claude-opus-4-8`) | via `@anthropic-ai/sdk` 0.110 |
| Graphiques | Recharts | 3.8 |
| Icônes | Lucide React | — |
| Tests unitaires | Vitest | 4.1.9 |
| Orchestration de synchronisation | n8n (workflows externes, hors dépôt applicatif) | — |
| Qualité de code | ESLint (config Next), TypeScript strict (`tsc --noEmit`) | — |

**Remarque de version :** ce projet utilise Next.js 16, dont plusieurs conventions diffèrent des versions précédentes (ex. `middleware.ts` renommé `proxy.ts`, typage strict des routes générées dans `.next/types`). Toute modification doit tenir compte de ces spécificités.

---

## 2. Architecture générale

### 2.1 Principe directeur : séparation moteur métier / affichage

Le code applicatif suit systématiquement un même patron :

```
Source de donnée (Supabase / API externe)
        │
        ▼
Module métier pur dans lib/*.ts (déterministe, testable unitairement)
        │
        ▼
Route API (app/api/**/route.ts) — applique le contrôle d'accès par rôle
        │
        ▼
Page "use client" (app/**/page.tsx) — fetch + affichage uniquement
```

Aucune logique de calcul de marge, de seuil ou d'agrégation n'est écrite directement dans un composant React : elle vit toujours dans `lib/`, ce qui permet de la tester indépendamment de l'interface (voir §8).

### 2.2 Server Components vs Client Components

Toutes les pages interactives sont des **Client Components** (`"use client"`), car elles dépendent du filtre de date global (contexte React) et de requêtes déclenchées par l'utilisateur. Les calculs qui manipulent des données confidentielles (marge, coûts, seuils) sont en revanche **exclusivement exécutés côté serveur** (routes API utilisant `supabaseAdmin`, la clé `service_role`), jamais dans un module importable par un composant client.

### 2.3 Contrôle d'accès au niveau routage : `proxy.ts`

Next.js 16 renomme le fichier de middleware historique `middleware.ts` en **`proxy.ts`**. Ce fichier :
- Redirige tout utilisateur non authentifié vers `/login` (sauf sur les routes publiques).
- Redirige un utilisateur déjà authentifié qui visite `/login` vers `/ceo`.
- Redirige hors des routes réservées au CEO (ex. `/ceo/market-settings`) tout utilisateur dont le rôle n'est pas `"ceo"`.

Ce contrôle est un confort d'expérience utilisateur : **la véritable barrière de sécurité est appliquée dans les routes API elles-mêmes** (voir §4), car un `proxy.ts` peut être contourné par un appel direct à l'API.

### 2.4 Filtre de date global et cohérence des dates par KPI

Un seul filtre de date (`Aujourd'hui · 7j · 30j · Mois en cours · Mois précédent · Personnalisé`, défaut 30 derniers jours) est partagé par tout le dashboard via un Context React (`FilterProvider`/`useFilters()`, `lib/filters.tsx`), monté une seule fois dans `app/layout.tsx` — il persiste donc sur toute navigation, sans être remonté par page. Le composant visible est `components/layout/DateRangeFilter.tsx`, rendu dans `Topbar` (présent en haut de chaque écran `/ceo/*`).

Chaque page passe le même couple `dateFrom/dateTo` à ses requêtes, mais **la bonne colonne de date par KPI est appliquée dans les fonctions RPC Postgres elles-mêmes** (pas dupliquée côté frontend) — une seule source de vérité, aucun risque qu'une page applique la mauvaise date.

⚠️ **`lib/filters.tsx` est la source de vérité pour ce mapping** (commentaire en tête de fichier) — le tableau ci-dessous n'est qu'une vue de lecture ; en cas de divergence, le code fait foi.

| Écran / KPI | Date de référence | Colonne source |
|---|---|---|
| Funnel (leads, confirmées, en attente, annulées, rupture stock, doublons) — ClickMarket / Coliscod / Africod Congo / Shipsen | Date de CRÉATION de la commande | `order_date` |
| CA livré / revenu livré — mêmes 4 réseaux | Date de LIVRAISON | `delivered_at` (`processed_at` pour Shipsen) |
| Rentabilité / marge nette (`/profitability`) | Date de LIVRAISON | `delivered_at` / `processed_at` |
| Trésorerie — cash encaissé (`/ceo`) | Date de LIVRAISON (proxy actuel — pas encore de date d'encaissement distincte) | `delivered_at` / `processed_at` |
| Seuils de rentabilité (`/thresholds`) | Date de LIVRAISON | `delivered_at` / `processed_at` |
| Copilot IA / Centre d'alertes | Mixte : funnel sur `order_date`, revenu sur date de livraison | `order_date` / `delivered_at` |
| Payout affilié (CRM Voralis, `/crm-voralis`) | Date de CRÉATION de commande (agrégat filtré côté CRM externe, pas de date d'engagement individuelle) | externe, non stockée |
| Ad spend (Meta Ads, `/meta-ads`) | Date de DÉPENSE | `date` (`meta_ads_by_country`) |
| Stock — quantités (`/inventory`) | NON FILTRÉ — état courant | — |
| Stock — vélocité de vente (ventes moyennes/jour) | Date de LIVRAISON des commandes utilisées pour la moyenne | `delivered_at` |
| Cash détenu « chez qui » (`/ceo`) | NON FILTRÉ — état courant (snapshot) | — |
| Cash rapatrié (statut) | NON FILTRÉ — statut seul, pas de date d'événement disponible aujourd'hui | — |

---

## 3. Modèle de données (Supabase / PostgreSQL)

### 3.1 Tables synchronisées automatiquement (source externe → Supabase, via n8n)

| Table | Alimentée par | Fréquence |
|---|---|---|
| `clickmarket_leads` | Workflow n8n `clickmarket-sync` | ~30 min |
| `coliscod_leads` | Workflow n8n `coliscod-sync` | ~30 min |
| `africod_congo_leads` | Workflow n8n `africod-congo-sync` | ~30 min |
| `shipsen_orders` | Workflow n8n `shipsen-sync` | ~30 min |
| `meta_ads_by_country` | Synchronisation Meta Ads (une ligne par pays/canal/jour, avec colonne `date` réelle) | quotidienne |

Pour chaque réseau logistique, des **fonctions SQL (RPC)** exposent les KPI déjà agrégés, en séparant explicitement deux bases temporelles distinctes :
- `kpi_<réseau>_marche_periode(date_from, date_to)` — indicateurs de **funnel**, filtrés sur la date de **création** de la commande.
- Les indicateurs de revenu (chiffre d'affaires livré) au sein de ces mêmes fonctions sont calculés sur la date de **livraison**.
- `kpi_<réseau>_par_produit_periode(date_from, date_to)` — mêmes indicateurs, ventilés par produit (utilisé par le module Stock).

### 3.2 Tables de configuration CEO (saisie manuelle, source unique de vérité)

| Table | Contenu | Particularité |
|---|---|---|
| `market_settings` | Taux de change, coût produit, taux de retour, taux de confirmation/livraison de référence, seuil de marge plancher confidentiel, par pays | Plusieurs colonnes **nullable** par design : `NULL` = "non renseigné", `0` = "valeur confirmée nulle" — ces deux états ne sont jamais confondus dans les calculs |
| `copilot_alert_thresholds` | Seuils configurables des alertes proactives (taux de rupture de stock, chute de DR%, cash non rapatrié) | Ligne unique (`id = 'default'`) |

### 3.3 Tables de saisie manuelle pure (aucune source API ne les alimente)

| Table | Contenu |
|---|---|
| `inventory` | Quantité en stock, délai d'approvisionnement, stock de sécurité, par pays/produit |
| `cash_holdings` | Cash détenu par des tiers (entité, montant, statut de rapatriement) |
| `cash_out_manual` | Sorties de cash manuelles (salaires locaux, autres frais) |

### 3.4 Sécurité au niveau base de données

Row Level Security (RLS) activée sur les tables manuelles, avec des politiques `to authenticated` pour la lecture. Les écritures sensibles (paramètres marché, seuils d'alerte) passent exclusivement par les routes API via la clé `service_role`, après vérification explicite du rôle applicatif — RLS n'est pas le seul rempart, elle complète le contrôle applicatif.

---

## 4. Authentification et contrôle d'accès par rôle (RBAC)

### 4.1 Stockage du rôle

Le rôle (`"ceo"` ou `"team"`) est stocké dans **`app_metadata`** de l'utilisateur Supabase Auth — un espace modifiable uniquement via l'API d'administration (clé `service_role`), **jamais** dans `user_metadata`, qui reste modifiable par l'utilisateur lui-même via le SDK client et serait donc falsifiable.

```ts
// lib/auth/role.ts
export async function getCurrentUserRole(): Promise<"ceo" | "team" | null> {
  // lit la session Supabase authentifiée (cookie), jamais une valeur envoyée par le client
  // rôle absent/inconnu → "team" (fail-closed)
}
```

### 4.2 Principe du gating serveur (jamais un filtrage côté client)

Chaque endpoint qui manipule une donnée confidentielle (marge, coûts, seuil plancher) **calcule** la donnée complète puis **retire entièrement la clé correspondante de l'objet de réponse** avant sérialisation si le rôle n'est pas `"ceo"` — la donnée ne transite jamais vers le navigateur, elle n'est pas simplement cachée par du CSS ou une condition d'affichage.

```ts
// lib/thresholds.ts
export function stripCeoDetail(rows: ThresholdRow[]): Omit<ThresholdRow, "ceoDetail">[] {
  return rows.map((row) => {
    const rest: ThresholdRow = { ...row };
    delete rest.ceoDetail; // la clé n'existe plus dans l'objet renvoyé
    return rest;
  });
}
```

Ce même principe est appliqué au Copilot IA : pour le rôle `"team"`, le champ `margin` n'est **jamais calculé et transmis** au modèle de langage, qui ne peut donc ni l'inventer ni le déduire.

---

## 5. Modules métier centraux (`lib/`)

| Fichier | Responsabilité |
|---|---|
| `lib/marketSettings.ts` | Constante `DELIVERY_FEE_USD = 11`, fonction unique `deliveryFeeLocal(fxToUsd)` réutilisée par tout le reste de l'application |
| `lib/margin.ts` | `computeBaseMargin()`, `computeL()`, `finalizeMargin()` — moteur de calcul de marge partagé par Rentabilité, Seuils et Copilot IA |
| `lib/thresholds.ts` | Calcul des plafonds CPL max / payout max par marché, agrégation serveur des 4 réseaux + Meta Ads + CRM Voralis |
| `lib/countries.ts` | Normalisation pays ↔ devise ↔ drapeau, avec gestion des alias ISO (alpha-2/alpha-3) car les sources externes ne codent pas les pays de façon uniforme |
| `lib/inventory.ts` | Calcul du seuil de réapprovisionnement (jamais stocké, toujours recalculé) |
| `lib/affiliates.ts` | Traitement des données du CRM Voralis (leaderboard affiliés/pays) |
| `lib/treasury.ts` | Agrégation Trésorerie (cash encaissé, cash out, payout affilié) |
| `lib/copilot/snapshot.ts` | Agrégateur serveur unique, sensible au rôle, pour le Copilot IA et les alertes |
| `lib/copilot/bottleneck.ts` | Moteur déterministe de classement des goulots d'étranglement (aucun appel LLM) |
| `lib/copilot/alerts.ts` | Génération des alertes proactives par template (aucun appel LLM) |

---

## 6. Intégrations externes

| Source | Type d'accès | Détail |
|---|---|---|
| CRM Voralis | API REST externe (`GET /api/v1/reports/networks`), clé `Bearer` partagée | Fournit les données par affilié et par pays (`by_country`), payout en USD exact, filtrage par période sur la date de création, calculé sur les commandes ayant atteint au moins le statut confirmé |
| Réseaux COD (ClickMarket, Coliscod, Africod Congo, Shipsen) | Fonctions SQL Supabase, alimentées par des workflows n8n | Chaque réseau a un schéma de synchronisation propre mais expose des colonnes strictement identiques côté application |
| Meta Ads | Table Supabase synchronisée quotidiennement | Une ligne par pays/canal/jour |
| API Anthropic (Claude) | Appel direct depuis la route serveur `app/api/copilot/chat/route.ts` | Clé `ANTHROPIC_API_KEY` côté serveur uniquement |

---

## 7. Architecture du Copilot IA (module le plus avancé)

Le Copilot IA repose sur une architecture en quatre couches, conçue pour qu'un modèle de langage **ne puisse jamais inventer ou recalculer un chiffre** — il ne fait que reformuler en langage naturel un résultat déjà calculé de façon déterministe.

```
1. lib/copilot/snapshot.ts
   Agrège toutes les sources existantes (funnel par réseau, marge, seuils, stock, trésorerie),
   sensible au rôle : les champs confidentiels ne sont même pas calculés pour le rôle "team".
        │
        ▼
2. lib/copilot/bottleneck.ts
   Moteur 100% déterministe (testé unitairement, lib/copilot/bottleneck.test.ts) qui classe
   les goulots d'étranglement par impact estimé vis-à-vis de l'objectif :
   50 commandes livrées + encaissées + rentables par jour.
        │
        ▼
3a. app/api/copilot/chat/route.ts          3b. lib/copilot/alerts.ts
    Appel à l'API Claude — le modèle             Génération des alertes proactives
    reçoit le résultat des étapes 1-2 et          par template (stock, CPL/payout,
    doit répondre au format OÙ / QUOI /           chute de DR%, cash non rapatrié) —
    IMPACT, jamais un tableau de chiffres.        aucun appel LLM, coût et latence nuls.
        │
        ▼
4. Gating par rôle (transversal aux 4 couches)
   Appliqué dès la couche 1 — jamais une étape de filtrage ajoutée après coup.
```

**Choix technique notable :** les alertes proactives sont volontairement rendues **sans appel au modèle de langage** (template déterministe), tandis que le chat conversationnel appelle l'API Claude — un compromis coût/latence/utilité validé explicitement pour ce projet.

---

## 8. Tests et qualité

### 8.1 Tests unitaires (Vitest)

Les moteurs de calcul les plus critiques sont couverts par des tests unitaires purs (aucun accès réseau ni base de données) :

- `lib/thresholds.test.ts` — vérifie la chaîne complète marge → L → CPL max → payout max sur un marché témoin réaliste, y compris l'impact réel du forfait de livraison de 11 USD et les cas limites (COGS nul, taux de confirmation à 0, AOV manquant).
- `lib/copilot/bottleneck.test.ts` — vérifie la classification de rentabilité (marge réelle pour le CEO, feu tricolore en repli pour l'équipe), le classement des goulots d'étranglement et la non-double-comptabilisation des marchés déjà jugés non rentables.

```bash
npx vitest run        # exécute la suite de tests
```

Une configuration `vitest.setup.ts` charge manuellement les variables d'environnement (`.env`), car Vitest ne les charge pas automatiquement comme le fait Next.js.

### 8.2 Séquence de vérification systématique

Après toute modification, la séquence suivante est exécutée avant de considérer un changement terminé :

```bash
npx tsc --noEmit    # vérification stricte des types
npm run build       # compile et régénère les types de routes Next.js (.next/types)
npx vitest run      # exécute la suite de tests unitaires
npm run lint        # ESLint
```

**Particularité Next.js 16 :** l'ajout ou le renommage d'une route (`app/api/**/route.ts` ou `app/**/page.tsx`) nécessite un passage par `npm run build` avant que `tsc --noEmit` ne valide correctement les types générés dans `.next/types/validator.ts` — ce cache de types est régénéré à chaque build.

---

## 9. Structure des dossiers

```
voralis-ceo/
├── app/
│   ├── ceo/                      # Toutes les pages du dashboard (Client Components)
│   │   ├── page.tsx              # Trésorerie
│   │   ├── profitability/        # Rentabilité
│   │   ├── thresholds/           # Seuils & plafonds
│   │   ├── meta-ads/             # Media Buying Interne
│   │   ├── logistics-cod/        # Réseaux Logistiques / COD
│   │   ├── crm-voralis/          # CRM Voralis / Affiliés
│   │   ├── inventory/            # Stock & Inventaire
│   │   ├── copilot/              # Copilot IA
│   │   ├── alerts/               # Centre d'alertes
│   │   ├── market-settings/      # Paramètres marché (CEO uniquement)
│   │   ├── team/                 # Gestion des accès
│   │   └── connections/          # État des synchronisations
│   ├── api/                      # Routes API (contrôle d'accès + accès données)
│   │   ├── copilot/              # chat, alerts, alert-thresholds
│   │   ├── market-settings/
│   │   ├── thresholds/
│   │   ├── inventory/
│   │   ├── cash-holdings/, cash-out-manual/
│   │   └── networks/, network-overview/, data-sources/, <réseau>/
│   └── login/
├── components/
│   ├── layout/                   # Sidebar, Topbar, DateRangeFilter
│   ├── kpi/                      # ProviderKpiTable (tableau partagé par les 4 réseaux)
│   └── ui/                       # Composants génériques (Section, Badge, KpiCard...)
├── lib/
│   ├── copilot/                  # Moteurs du Copilot IA (snapshot, bottleneck, alerts)
│   ├── supabase/                 # Clients Supabase (browser, server/admin, requêtes)
│   ├── auth/                     # Résolution du rôle utilisateur
│   └── *.ts                      # Moteurs métier (margin, thresholds, marketSettings, ...)
├── supabase/                     # Scripts SQL (schémas + migrations, exécutés manuellement)
├── n8n/                          # Définitions des workflows de synchronisation externes
├── proxy.ts                      # Middleware Next.js 16 (RBAC au niveau routage)
└── vitest.setup.ts               # Chargement des variables d'environnement pour les tests
```

---

## 10. Choix d'architecture et justifications

| Décision | Justification |
|---|---|
| `NULL` ≠ `0` systématiquement | Un coût non renseigné ne doit jamais être traité comme un coût nul — sinon la marge affichée serait fausse sans que personne ne le sache |
| Devises jamais additionnées | Un total en "AOA + XAF" n'a aucun sens économique ; le CEO doit rester seul maître de la conversion |
| Moteur déterministe séparé du LLM (Copilot IA) | Empêche structurellement l'invention ou le recalcul erroné d'un chiffre par le modèle de langage — le LLM ne fait que mettre en forme |
| Gating par suppression de clé côté serveur, jamais par condition d'affichage | Une donnée qui n'est jamais sérialisée ne peut pas fuiter, même par une inspection réseau côté navigateur |
| Frais de livraison en constante centralisée (`deliveryFeeLocal()`) | Une seule fonction réutilisée partout évite qu'une future évolution du montant ne soit appliquée de façon incohérente entre les écrans |
| Duplication volontaire de certaines agrégations (client vs serveur) | Les fonctions appelées depuis le navigateur utilisent la session utilisateur (RPC "authenticated") ; celles appelées depuis une route serveur pure utilisent `service_role` — la logique est identique, seul le transport diffère |

---

## 11. Variables d'environnement requises

| Variable | Usage |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client Supabase (navigateur + session) |
| `SUPABASE_SERVICE_ROLE_KEY` | Client Supabase administrateur (routes serveur uniquement) |
| `REPORTING_API_KEY` | Authentification auprès du CRM Voralis |
| `ANTHROPIC_API_KEY` | Appels à l'API Claude (Copilot IA) |
| `CLICKMARKET_*`, `COLISCOD_*`, `AFRICOD_CONGO_*`, `SHIPSEN_*` | Identifiants de synchronisation par réseau (utilisés par les workflows n8n) |
