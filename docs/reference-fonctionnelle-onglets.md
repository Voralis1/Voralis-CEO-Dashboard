# Référence fonctionnelle & technique — Onglets du Dashboard CEO Voralis

> Document complémentaire au [SOP principal](./SOP-dashboard-ceo.md) : fonctionnement détaillé de chaque onglet, formules de calcul exactes et stockage des données. Le SOP principal décrit la conception du dashboard et sert de guide d'utilisation général ; ce document est la **référence technique exacte** (formules, tables Supabase, colonnes de date) pour qui doit vérifier ou modifier un calcul précis.
> Généré le 2026-08-07 à partir du code source (`voralis-ceo/`) — toute évolution du code doit s'accompagner d'une mise à jour de ce document.

---

## 1. Objectif général du dashboard

Le dashboard CEO Voralis centralise, pour une activité e-commerce COD (Cash On Delivery) opérant sur 10+ marchés africains (Angola, Gabon, Congo, Mali, Guinée, Sénégal, Côte d'Ivoire, Burkina Faso, Maroc, Cameroun, Argentine, Centrafrique), l'ensemble des données nécessaires à une seule question directrice :

> **Combien de commandes sont livrées ET encaissées ET rentables, chaque jour, par pays ?**

Il agrège en un seul endroit des sources auparavant dispersées : 7 réseaux logistiques partenaires (COD), la régie publicitaire Meta Ads (média interne), le CRM d'affiliation externe Voralis, une mini-application de logistique interne pour l'Angola ("Field Cash"), et la configuration marché (taux de change, coûts, modèle de livraison) saisie par le CEO.

**Principes de conception transversaux**, valables sur tout le dashboard (répétés dans les commentaires de code comme garde-fous) :

- **Base "livré + encaissé"** : sauf mention contraire explicite, un montant de chiffre d'affaires n'existe dans le dashboard que si la commande est réellement livrée ET le cash réellement encaissé — jamais une commande simplement "confirmée" ou "en cours".
- **Devises jamais additionnées entre pays** : chaque pays a sa devise locale réelle (AOA, XAF, XOF, GNF, MAD...) ; les totaux affichés en USD le sont uniquement pour comparaison ligne par ligne, jamais en sommant des devises différentes entre elles.
- **`null` ≠ `0`** : une donnée manquante ou non calculable s'affiche explicitement comme telle ("donnée manquante", badge, tiret avec info-bulle) — jamais silencieusement remplacée par zéro, ce qui fausserait une marge ou un total.
- **Rôles CEO / team** : deux niveaux d'accès. Le rôle **CEO** voit la marge nette, le COGS, la marge plancher T et le détail des coûts. Le rôle **team** voit uniquement les indicateurs opérationnels et des feux tricolores (vert/orange/rouge) sans jamais voir le chiffre de marge sous-jacent — appliqué côté serveur (la donnée confidentielle ne quitte jamais le backend), jamais un simple masquage visuel côté client.
- **Aucune saisie manuelle de résultat** : les seuls champs modifiables à la main par le CEO sont des paramètres de configuration (`market_settings` : taux de change, taux de référence, AOV simulé, marge plancher) — jamais un chiffre d'affaires, une marge ou un statut de commande, tous recalculés en direct depuis les sources.

---

## 2. Rôles, accès et architecture technique (résumé)

| Couche | Technologie |
|---|---|
| Framework web | Next.js (App Router) + React + TypeScript |
| Style | Tailwind CSS |
| Base de données | Supabase (PostgreSQL + Auth + Row Level Security) |
| IA conversationnelle (Copilot) | OpenRouter (API compatible OpenAI), modèle `moonshotai/kimi-k3` |
| Tests unitaires | Vitest |
| Synchronisation des sources | Scripts Python planifiés (cron / GitHub Actions), upsert idempotent — remplace l'ancien orchestrateur n8n |

**Pipeline de données** : Sources externes (API réseaux logistiques, API Meta Ads, API CRM Voralis) → scripts Python de synchronisation → tables Supabase (PostgreSQL) → fonctions RPC / vues SQL par réseau (agrégation `kpi_<réseau>_marche_periode`) → API routes Next.js (`app/api/**`) ou appel client direct (RLS `authenticated`) → pages `/ceo/**`.

**Filtre de dates global** : toutes les pages (sauf indication contraire) partagent un même sélecteur "De / À" (`useFilters()`), appliqué de manière cohérente à chaque source — mais chaque source peut avoir sa propre colonne de référence pour "la date" (date de commande, date de confirmation, date de livraison, date de dépense) : ce point est précisé onglet par onglet ci-dessous, car c'est une source fréquente d'écarts entre deux tableaux qui semblent porter sur "la même période".

---

## 3. Les onglets du dashboard

Ordre du menu latéral (`components/layout/Sidebar.tsx`) :

1. Tableau de bord
2. Trésorerie
3. Rentabilité
4. Seuils & plafonds
5. Media Buying Interne
6. Affiliés externes
7. Réseaux Logistiques
8. Stock & Inventaire
9. Copilot IA
10. Alertes
11. Équipe
12. Sources
13. Paramètres marché

---

### 3.1 Tableau de bord (`/ceo/dashboard`)

**Objectif** : donner une vue d'ensemble rapide et **journalière** de la performance commerciale globale (tous pays confondus) — courbes d'évolution, comparaison par pays, podium des meilleurs affiliés. Ce n'est **pas** un remplacement du détail précis par pays de l'onglet Rentabilité, qui reste la référence en devise locale ; ici tout est converti et sommé en USD pour une lecture rapide tous pays confondus.

**Ce qui est affiché** :

- 3 courbes journalières : CA livré encaissé (USD), marge nette réelle (USD), commandes livrées.
- 2 diagrammes en barres de comparaison par pays.
- Podium des 5 meilleurs affiliés externes, classés sur leur rentabilité nette.

**Formules exactes**

CA livré (USD), par commande livrée, tous réseaux confondus :

> **CA livré (USD)** = (Prix total de la commande ÷ Taux de change du pays vers USD) − (Forfait de livraison de base 11 $ + Charge fixe 2 $)
> soit : (Prix total de la commande ÷ Taux de change du pays vers USD) − **13 $**

Si le pays n'a pas de taux de change connu (non renseigné dans Paramètres marché), la ligne est **exclue** silencieusement de ce calcul (pas de taux fiable).

Marge nette réelle (USD), **par jour** (2026-08-07 — remplace l'ancienne « marge simplifiée ») :

> **Marge nette réelle (USD) du jour** = CA livré (USD) du jour − Dépense publicitaire Meta Ads (USD) du jour − Payout affilié réel du jour (USD) − COGS du jour (USD)
>
> où **COGS du jour** = Quantité de produit expédiée ce jour-là × 15 $/unité (7 $ production + 8 $ transport, mêmes constantes que Rentabilité).

Contrairement à l'ancienne version, ce n'est plus une approximation disclosed : chaque terme est une vraie valeur du jour, pas une simplification ni une répartition estimée d'un total période — y compris le payout affilié, obtenu en interrogeant le CRM Voralis **avec ce jour précis comme borne de dates** (`from=to=ce jour`), exactement comme le fait Rentabilité pour toute la période d'un coup. Sommé en USD tous pays confondus pour cette vue d'ensemble — Rentabilité (§3.3), elle, ne fait jamais cette addition et reste toujours en devise locale (Règle 3). Un jour où l'appel au CRM Voralis échoue (timeout, erreur réseau) laisse un **trou dans la courbe** ce jour-là plutôt qu'un 0 qui fausserait la marge affichée — jamais de repli silencieux. Angola utilise ici le forfait de livraison standard comme les 6 autres marchés (même simplification déjà assumée pour la courbe de CA livré), pas le coût réel Field Cash au jour le jour.

Podium affiliés :

> **Marge nette de l'affilié (USD)** = CA livré (USD) généré par l'affilié − Payout total versé à l'affilié (USD)
> (vide si le CA livré de l'affilié n'est pas connu)

Un affilié dont la marge nette n'est pas calculable est exclu du classement.

**Sources de données**

| Source | Rôle |
|---|---|
| `clickmarket_leads`, `coliscod_leads`, `africod_congo_leads` (requêtées directement, pas via RPC) | commandes livrées, filtre statut + date, décalage WAT +1h |
| `shipsen_orders`, `shiplead_orders`, `mlshipafrica_orders` | commandes livrées, colonne `shipping_date` |
| `ikatchiexpress_orders` | commandes livrées, statut `'Livrée'` |
| `market_settings` (`pays, fx_to_usd` uniquement — pas les champs confidentiels) | taux `fx_to_usd`, pour nettoyer le CA livré du forfait de livraison |
| `meta_ads_by_country` | dépense pub journalière (déjà en USD) |
| CRM Voralis (`/api/v1/reports/networks`, un appel par jour) | payout affilié réel du jour — marge nette réelle |
| CRM Voralis (`/api/networks`, `/api/v1/reports/orders`) | podium affiliés |
| `clickmarket_shipments`, `coliscod_shipments`, `africod_congo_shipments`, `shipsen_expeditions`, `shiplead_shipments`, `mlshipafrica_shipments` | quantité expédiée du jour — COGS de la marge nette réelle |

Les courbes CA livré/marge/commandes livrées **n'utilisent pas** les fonctions RPC `kpi_*_marche_periode` (celles-ci ne renvoient qu'un total par période, sans granularité journalière) — elles requêtent les tables brutes directement, avec exactement la même définition de "livré" que chaque RPC équivalente, plus une marge de ±1 jour sur la requête SQL pour absorber le décalage horaire, filtrée précisément ensuite en JavaScript.

⚠️ **Point d'accès (rôle)** : la marge nette réelle est calculée et gatée **côté serveur** dans `app/api/dashboard/timeseries/route.ts` (`getCurrentUserRole()`) — un utilisateur au rôle `team` reçoit `margeReelleUsd: null` sur tous les jours (message « réservé au rôle CEO » affiché à la place de la courbe), jamais une erreur qui casserait le reste de la page. Le podium affiliés de ce même onglet reste néanmoins soumis à l'ancien comportement (erreur 403 en cascade via `fetchMarketSettings()`, cf. Rentabilité §3.3) — non corrigé par ce changement, à traiter séparément.
⚠️ **Point de performance** : le calcul de la marge journalière fait un appel réseau au CRM Voralis **par jour** de la période sélectionnée (en parallèle) — une période « Personnalisé » très longue (plusieurs mois) ralentira sensiblement le chargement de cette courbe. Pas de limite dure posée à ce jour.

---

### 3.2 Trésorerie (`/ceo`, page d'accueil)

**Objectif** : répondre à « combien de cash a réellement été encaissé, et combien est sorti, pays par pays, sans jamais mélanger deux devises ? ». C'est le tableau de bord de trésorerie opérationnelle. Depuis le 2026-07-08, cette page est **100% lecture seule** — plus de saisie manuelle de cash détenu ou de sorties (les anciennes sections "Cash chez qui" / "Cash Out manuel" ont été retirées).

**Bloc "Cash encaissé par pays"**

1. `networkLivres` / `networkCaLivre` : somme des 7 réseaux logistiques COD par pays (déjà net de 13$/commande côté SQL).
2. **Angola** uniquement : le canal Coliscod est additionné au canal interne Field Cash :
   ```
   livres  = networkLivres(Coliscod) + recap.nbDeliveries
   caLivre = networkCaLivre(Coliscod) + recap.totalEncaisse
   ```
3. Frais de livraison :
   - 6 pays externes : `fraisLivraisonTotal = livres × 13 $ équivalent devise locale`.
   - Angola : `fraisLivraisonTotal = livres_Coliscod × 13 $ + recap.fraisLivraisonInterneTotal` (coût réel Field Cash). Si `field_delivery_params` absent pour l'Angola → ligne exclue entièrement (pas de cash fiable à afficher).
4. Colonne finale :
   ```
   cashEncaisse = caLivre − fraisLivraisonTotal
   ```

**Bloc "Cash Out par pays"** (pour chaque pays de `market_settings`, même sans commande livrée) :
```
adSpendLocal      = adSpendUsd × fx_to_usd
payoutAffilieLocal = payoutAffilieUsd × fx_to_usd     (CRM Voralis, by_country, USD)
cogsLocal          = (7 + 8) × quantitéExpédiée × fx_to_usd   =  15 $/unité expédiée
fraisLogistiqueLocal = fraisLivraisonTotal + chargesExternesTotal   (0 hors Angola)

total = adSpendLocal + payoutAffilieLocal + cogsLocal + fraisLogistiqueLocal
```
Une ligne dont les 4 composantes valent 0 est omise. Les pays hors `market_settings` mais présents dans Meta Ads sont ajoutés à part, en USD, ad spend seul.

**Sources de données** : les 7 réseaux logistiques (voir §3.7), `market_settings`, `meta_ads_by_country`, CRM Voralis (`/api/networks`), les tables `*_shipments` (quantité expédiée pour le COGS), et pour l'Angola : `field_deliveries`, `field_charges`, `field_delivery_params`.

**Caveats notables**
- Commission agent Angola : forfait de **2 000 (devise locale) par livraison**, extrait du cash détenu restant à l'affichage (n'affecte jamais le moteur de marge) :
  ```
  cashDetenuRestant = totalEncaisse − fraisLivraisonInterneTotal − chargesExternesTotal − remisTotal − commissionAgentTotal
  ```
- Seul `statut = 'received'` (Field Cash) réduit le cash détenu ; `'pending'`/`'sent'` restent affichés "en transit", jamais soustraits tant que non confirmés.
- Coût call center : déjà inclus dans les 11 $/commande, jamais déduit séparément.

---

### 3.3 Rentabilité (`/ceo/profitability`)

**Objectif** : afficher la **marge nette réelle par pays**, toutes affiliations confondues (media buying interne + affiliés externes), en s'appuyant uniquement sur les données des partenaires logistiques comme source de vérité du volume livré.

**Formule complète, par pays** :
```
Marge nette = CA livré encaissé − Frais livraison − Ad spend − Payout affiliés − COGS − Charges externes
```

**Poste par poste**

| # | Poste | Formule |
|---|---|---|
| 1 | **Livrées / CA livré encaissé** | Σ commandes livrées sur les 7 réseaux logistiques (tous canaux confondus — media buying interne ET affiliés externes, pas de distinction ni de soustraction entre les deux). Angola : + volume/CA de la flotte interne Field Cash. |
| 2 | **Frais de livraison** | 6 pays : `Livrées × 13 $` (11$ forfait + 2$ charge fixe, call center inclus). Angola : `13$ × livrées Coliscod + coût réel flotte interne (Field Cash)`. |
| 3 | **Ad spend** | Dépense Meta Ads du pays sur la période (date de dépense réelle), convertie en devise locale. 0 si aucune dépense enregistrée (pas une anomalie). |
| 4 | **Payout affiliés** | Total payout CRM Voralis du pays (`by_country`, toujours en USD, payé à la commande **confirmée**), converti en devise locale. |
| 5 | **COGS** | `(7 $ production + 8 $ expédition) × quantité physiquement expédiée × fx_to_usd` = 15 $/unité expédiée (pas par commande livrée). |
| 6 | **Charges externes** | Angola uniquement : dépenses réelles de la flotte interne (`field_charges`). 0 pour les 6 autres pays (déjà capturé dans le forfait 13$). |
| 7 | **Profit par commande livrée (PPDO)** | `Marge nette ÷ Livrées`. |

Si une donnée d'entrée manque (frais livraison, COGS, ad spend+payout), la marge s'affiche "donnée manquante" plutôt que d'être calculée avec un 0 caché. Un pays servi par un réseau logistique mais absent de `market_settings` (nouveau marché) est affiché quand même, avec le badge "config manquante", marge non calculable.

**Sources de données** : les 7 réseaux logistiques COD, `market_settings`, `meta_ads_by_country`, CRM Voralis (`/api/networks`, bloc `by_country`), les tables `*_shipments` (quantité expédiée), `field_deliveries`/`field_charges` (Angola).

**Historique de la décision de conception** : jusqu'au 2026-08-05, ce tableau soustrayait la part affiliée (CRM Voralis) du total réseau brut pour ne pas la compter deux fois avec l'ad spend Meta Ads — car la même commande livrée par un affilié apparaît aussi dans la table du réseau logistique. Le CEO a demandé de fusionner les deux vues : le total réseau (déjà "toutes affiliations confondues") sert de référence unique, et les deux coûts d'acquisition (ad spend ET payout affiliés) sont désormais déduits ensemble, quel que soit le canal réel d'origine de chaque commande.

---

### 3.4 Seuils & plafonds (`/ceo/thresholds`)

**Objectif** : donner, par pays, le **plafond de CPL** (coût par lead publicitaire) et le **plafond de payout affilié** au-delà desquels une commande devient non rentable — pour arbitrer en temps réel une décision "scale / surveiller / stop" sur une campagne ou un partenariat affilié, sans exposer la marge elle-même à l'équipe.

**Chaîne de calcul (le moteur, `lib/thresholds.ts`)**

1. **AOV utilisé** = AOV observé sur la période (moyenne réelle), sauf si le CEO a saisi un `aov_override` dans Paramètres marché (badge "AOV simulé").
2. **Frais de livraison par unité** : même logique que Rentabilité (13$ forfait, ou coût réel Field Cash pondéré pour l'Angola).
3. **COGS par unité** = `(7+8) × fx_to_usd` = 15 $/unité (constant, un produit simulé = une unité).
4. **M (marge par commande avant coût d'acquisition)** :
   ```
   M_local = (AOV − frais_livraison_unitaire) − cogs_unitaire
   M_usd   = M_local / fx_to_usd
   ```
5. **T (marge plancher, confidentiel CEO)** = `market_settings.marge_plancher_t`, `T_usd = T_local / fx_to_usd`.
6. **L (leads nécessaires pour 1 livrée)** :
   ```
   L = 1 / (conf% × dr%)
   ```
   `conf%`/`dr%` observés sur la période priment sur la saisie manuelle `market_settings.conf_pct`/`dr_pct`, qui ne sert que de repli si aucune commande n'existe encore sur la période.
7. **Plafonds CPL** :
   ```
   cplMaxUsd       = (M_usd − T_usd) / L        (rentable avec marge de sécurité T)
   cplBreakEvenUsd = M_usd / L                  (seuil de rentabilité stricte, sans marge de sécurité)
   ```
8. **Plafonds payout affilié** (`AFFILIATE_PAYOUT_MAX_USD = 9`, forfait fixe CEO) :
   ```
   payoutMaxUsd       = 9
   payoutBreakEvenUsd = 9 × M_usd / (M_usd − T_usd)     (même proportion de sécurité que le CPL)
   ```
9. **Code couleur** (`cplColor`/`payoutColor`) : `réel ≤ max` → 🟢 vert (scale) ; `max < réel ≤ break-even` → 🟠 orange (surveiller) ; `réel > break-even` → 🔴 rouge (stop) ; pas de réel connu → `null` (tiret, pas de couleur).

**Ce qui est affiché à l'écran** : deux tableaux — "Réseaux logistiques · CPL max par marché" et "Affiliés · payout max par confirmée". En vue **CEO**, colonnes supplémentaires AOV/M/T/L visibles. En vue **team**, seuls les plafonds actionnables et le badge couleur sont visibles — un bandeau rappelle explicitement que la marge, T et la décomposition des coûts restent réservées au CEO (gating fait côté serveur, l'API renvoie deux formes de réponse différentes selon le rôle).

**Sources de données** : les 7 réseaux logistiques (pour `conf%`/`dr%` observés et l'AOV), `market_settings`, CRM Voralis `by_country` (`payoutReelUsd = total_payout / confirmed_orders`).

---

### 3.5 Media Buying Interne (`/ceo/meta-ads`)

**Objectif** : suivre la dépense publicitaire Meta Ads (média interne, par opposition aux affiliés), agrégée par pays puis par compte publicitaire.

**Colonnes et formules** (identiques sur les deux tableaux — par pays et par compte) :

| Colonne | Formule |
|---|---|
| Spend | somme brute (déjà en USD dans la source) |
| Clicks / Impressions / Leads | sommes brutes |
| CPL (coût par lead) | `spend / leads` (0 si `leads = 0`) |
| CTR (taux de clic) | `(clicks / impressions) × 100` (0 si `impressions = 0`) — badge vert ≥6.5%, jaune ≥5%, rouge sinon |

**Sources de données** : `meta_ads_by_country` (par pays), `meta_ads_by_account` (par compte publicitaire) — filtrées sur la colonne `date` réelle de la dépense.

---

### 3.6 Affiliés externes (`/ceo/crm-voralis`)

**Objectif** : évaluer chaque affilié externe (réseau CRM Voralis) et chaque pays sur une base **livré + rentabilité**, jamais uniquement sur le taux de confirmation (diagnostic funnel seulement, jamais décisionnel — rappelé explicitement dans le sous-titre de la page).

**Deux tableaux**

*Leaderboard par affilié* — colonnes : Commandes, Confirmées (diagnostic), Livrées, DR%, Payout total (USD), Coût payout / confirmée, Rentabilité nette (USD).

*Leaderboard par pays (tous affiliés confondus)* — mêmes colonnes + CA livré encaissé et Marge nette en devise locale.

**Formules**
```
drPct                 = deliveredOrders / confirmedOrders × 100
payoutPerConfirmedUsd = totalPayoutUsd / confirmedOrders          (payé à la CONFIRMATION, pas à la livraison)
margeNetteUsd (par affilié) = caLivreUsd − totalPayoutUsd
margeNettePays (par pays)   = caLivrePays − (payoutTotalPays × fx_to_usd)
```
`caLivreUsd`/`caLivrePays` viennent des commandes individuelles livrées (`/api/v1/reports/orders`, statut `delivered`), agrégées commande par commande dans SA propre devise — jamais en additionnant des devises différentes. `null` si aucune commande livrée sur la période, ou si une commande livrée est dans une devise sans taux `fx_to_usd` connu (jamais un total sous-évalué en silence).

Un badge rouge "coût élevé" s'affiche si `payoutPerConfirmedUsd > 10 $` (`PAYOUT_ALERT_THRESHOLD_USD`, seuil fixé par le CEO).

**Note d'approximation affichée à l'écran** : la marge nette par pays de cet onglet ne soustrait QUE le payout affilié — pas les frais de livraison ni le COGS (déjà pris en compte dans l'onglet Rentabilité, qui reste la référence de marge complète).

**Sources de données** : CRM Voralis, `/api/networks` (stats par affilié/réseau/pays) et `/api/v1/reports/orders` (commandes individuelles avec prix réel) ; `market_settings` pour la conversion devise.

---

### 3.7 Réseaux Logistiques (`/ceo/logistics-cod` + sous-pages fusionnées)

**Objectif** : détail du funnel (leads → confirmées → livrées → CA livré) pour chacun des 7 réseaux logistiques COD, un onglet à la fois — plus un 8e onglet "Field Cash Angola" (logistique interne, hors réseau externe).

> Les anciennes URLs `/ceo/africod-congo`, `/ceo/shipsen`, `/ceo/coliscod`, `/ceo/clickmarket` redirigent désormais vers `/ceo/logistics-cod?reseau=<id>` — tout le contenu vit dans la page hub. Décision CEO (2026-07-31) : un seul réseau affiché à la fois plutôt que tous empilés, pour éliminer le risque de confondre deux tableaux à logique de date différente juxtaposés à l'écran.

**Colonnes communes** (composant `ProviderKpiTable`) : Pays, Total commande (avec doublons en sous-note), Commandes confirmées, Livrées, Taux livraison, AOV encaissé, CA livré encaissé, Annulées, Délai moyen 1er contact.

```
tauxLivraison = livres / totalLeads × 100     (badge vert ≥70%, jaune ≥50%, rouge sinon)
AOV encaissé  = caLivre / livres               (— si livres = 0)
CA livré      = Σ(total_price des commandes livrées) − 13 $ × livres
```
Toujours en devise locale (`market_settings`), jamais additionné entre pays.

**Détail par réseau — statuts et particularités**

| Réseau | Table(s) | "Confirmé" | "Livré" | Particularité |
|---|---|---|---|---|
| **ClickMarket** | `clickmarket_leads` | `confirmed_at` renseigné | `shipping_status ∈ {processed, delivered, paid}` + `delivered_at` renseigné | Décalage horaire WAT (+1h) sur toutes les dates ; seul réseau avec statut `out_of_stock` (rupture de stock) |
| **Coliscod Angola** | `coliscod_leads` | idem | idem | Décalage WAT +1h ; pas de `out_of_stock` |
| **Africod Congo** | `africod_congo_leads` | idem | idem | Décalage WAT +1h ; ni doublons ni `out_of_stock` observés |
| **Shipsen** | `shipsen_leads` + `shipsen_orders` | `status_name = 'Confirmed'` (fenêtre `updated_at`) | `status ∈ {processed, delivered, paid}` (fenêtre `shipping_date`) | `total_orders = confirmées + annulées` (redéfini pour matcher le widget natif Shipsen — spécifique à ce réseau) |
| **ShipLead** | `shiplead_leads` + `shiplead_orders` | idem Shipsen | idem Shipsen | Même backend que Shipsen ; sert aussi Cameroun/Argentine |
| **MLShipAfrica** | `mlshipafrica_leads` + `mlshipafrica_orders` | idem | idem | `total_orders` = `count(*)` de tous les leads (pas confirmées+annulées, corrigé le 2026-08-05) ; statut retour `'return'` (pas `'refunded'`) ; doublons réellement peuplés |
| **Ikatchiexpress** | `ikatchiexpress_orders` (table unique) | `status = 'Confirmée'` | `status = 'Livrée'` | Un seul champ statut en français, pas de split leads/shippings ; délai 1er contact toujours `null` (pas de signal API) |

**"CA livré" déduit systématiquement 13 $/commande livrée** (11$ forfait + 2$ charge fixe, call center inclus), sur les 7 réseaux — pas de conversion `fx_to_usd` à ce niveau (le montant reste en devise locale native de chaque réseau).

**Onglet Field Cash Angola** (hors `ProviderKpiRow`) : Total encaissé, Livraisons collectées, Frais de livraison internes, Charges externes, Commission agent, Remis / En transit, Montant restant :
```
Montant restant = Total encaissé − Frais livraison internes − Charges externes − Commission agent − Remis (reçu)
```

---

### 3.8 Stock & Inventaire (`/ceo/inventory`)

**Objectif** : deux choses distinctes à ne jamais confondre — (a) le **stock côté vente** en Angola (lu en direct depuis le CRM Voralis), et (b) le **stock entrant** (expéditions fournisseur → warehouse, pas encore vendues) pour les 6 autres marchés, un tableau par réseau logistique.

**a) Inventaire Angola** : `GET /api/v1/products/stock` (CRM Voralis, lecture seule) — colonnes Pays, Produit, Quantité stock, Statut. Filtré pour ne montrer que l'Angola.

**b) Stock entrant par réseau** (6 tableaux) : lit directement les tables `clickmarket_shipments`, `coliscod_shipments`, `africod_congo_shipments`, `shipsen_expeditions`, `shiplead_shipments`, `mlshipafrica_shipments`. Colonnes : Pays, Produit, Date d'expédition, Date de réception, Origine, Qté envoyée, Qté arrivée, Qté défectueuse (mise en évidence si > 0), Statut.

Un réseau n'est affiché sur l'onglet d'un marché donné que s'il a déjà expédié vers ce marché au moins une fois (détection dynamique sur tout l'historique, indépendante du filtre de dates affiché) — jamais une liste de couverture codée en dur.

> **Dette technique documentée** : le module historique `lib/inventory.ts` (table `inventory`, seuil de réapprovisionnement `= ventes_moyennes_jour × délai_appro + stock_sécurité`) n'est **plus lu** par cette page depuis le 2026-07-08, mais reste utilisé côté serveur par le moteur d'alertes du Copilot IA (rupture de stock / à commander).

---

### 3.9 Copilot IA (`/ceo/copilot`)

**Objectif** : un chat qui priorise les actions vers l'objectif directeur unique — **`DAILY_TARGET_RENTABLE_LIVRAISONS = 50` commandes livrées, encaissées et rentables par jour**.

**Architecture en 3 étapes (validée CEO)** :
1. `buildCopilotSnapshot(dateFrom, dateTo, role)` — calcule TOUS les chiffres (déterministe, testé unitairement), agrège l'ensemble des tables du dashboard.
2. `computeBottleneckAnalysis(snapshot)` — classe les goulots d'étranglement par marché/étape du funnel (acquisition, confirmation, livraison, marge), 100% déterministe, aucun LLM.
3. Le LLM (**OpenRouter, modèle `moonshotai/kimi-k3`**) ne fait QUE reformuler ce classement en actions priorisées — il ne recalcule ni n'invente jamais un chiffre.

**Format de réponse imposé** : pour chaque point, **OÙ** (marché/réseau/affilié + étape funnel) / **QUOI** (action concrète) / **IMPACT** (gain estimé, repris tel quel du calcul fourni). Priorise le goulot le plus impactant en premier.

**Gating par rôle** : appliqué en amont dans `buildCopilotSnapshot()` — pour le rôle `"team"`, le champ marge est **retiré du snapshot avant même d'atteindre le LLM** (jamais un simple filtrage d'affichage). Le prompt système adapte sa consigne : le rôle `team` s'appuie uniquement sur le feu tricolore CPL/payout, jamais sur un chiffre de marge exact, même approximatif.

**Sources de données** : l'ensemble des tables/API du dashboard, via `buildCopilotSnapshot`/`computeBottleneckAnalysis` (mêmes moteurs que Rentabilité, Seuils, Trésorerie, Stock, Field Cash).

---

### 3.10 Alertes (`/ceo/alerts`)

**Objectif** : deux moteurs d'alertes distincts, calculés en direct (aucune alerte stockée en base).

**Moteur "proactif" (funnel & marge)** — réutilise `CopilotSnapshot`/`BottleneckAnalysis`, rendu par template (pas d'appel LLM). Règles, dans l'ordre de gravité :

| Alerte | Condition | Niveau |
|---|---|---|
| Rupture de stock | `statut = "rupture"` | 🔴 critique |
| Stock sous seuil | `statut = "a_commander"` ou taux de rupture > seuil configuré | 🟠 avertissement |
| CPL réel en zone rouge | `cplColor = "red"` (au-dessus du break-even, voir §3.4) | 🔴 critique |
| Payout réel en zone rouge | `payoutColor = "red"` | 🔴 critique |
| Chute du taux de livraison (DR%) | baisse ≥ seuil configuré vs période précédente équivalente | 🟠 avertissement |
| Cash non rapatrié | somme (USD) des montants "en attente" > seuil configuré | 🟠 avertissement |
| Angles morts structurels (délai 1er contact, motifs d'annulation/retour) | toujours rappelés | ℹ️ info |
| Top 3 goulots d'étranglement | issus de `computeBottleneckAnalysis` | 🔴 si étape = marge, sinon 🟠 |

Seuils configurables par le CEO, table `copilot_alert_thresholds` (`taux_rupture_stock_max_pct`, `dr_pct_drop_max_points`, `cash_non_rapatrie_max_usd`).

**Moteur "legacy"** — seuils fixes en dur (`lib/dashboardData.ts`) :

| Métrique | Seuil critique | Seuil avertissement |
|---|---|---|
| Taux de confirmation | < 30% | < 45% |
| Taux de livraison | < 40% | < 55% |
| Meta Ads sans leads | `leads = 0` et `spend > 20$` | — |
| CPL Meta Ads | — | `> 3$` |

Appliqué aux 7 réseaux logistiques + Meta Ads + erreurs de synchronisation des sources.

---

### 3.11 Équipe (`/ceo/team`)

**Objectif** : malgré son nom, cet onglet **ne gère pas de comptes/rôles utilisateurs** (géré ailleurs via Supabase Auth) — c'est un suivi de **performance des agents terrain** (livreurs), limité à l'Angola, seul marché où cette donnée existe (mini-app Field Cash, table `field_deliveries`, colonne `agent`).

**Contenu** : Livraisons collectées et Cash encaissé par agent (Angola uniquement). Pour les 6 autres marchés (prestataires logistiques externes), la page affiche explicitement "donnée manquante" plutôt qu'un chiffre inventé — leurs frais sont inclus dans le forfait de livraison, aucune source n'expose de détail par livreur individuel.

---

### 3.12 Sources (`/ceo/connections`)

**Objectif** : santé du pipeline de données en direct — statut de chaque table Supabase et de l'API CRM Voralis, à chaque chargement de page (pas de cache).

**Logique de statut** : pour chaque table, une requête `count` détermine :
- `rowCount > 0` → 🟢 Connecté.
- `rowCount = 0` → 🟠 Aucune donnée.
- Erreur de requête → 🔴 Erreur.
- CRM Voralis : ping direct de l'API (`/api/v1/reports/networks`) plutôt qu'une table.

**9 sources suivies** : Meta Ads, Shipsen, Coliscod Angola, Africod Congo, ClickMarket, ShipLead, MLShipAfrica, Ikatchiexpress, CRM Voralis. Aucune notion de fraîcheur par âge (pas de seuil "dernière synchro > X heures = obsolète") — le statut dépend uniquement de la présence de données et de l'absence d'erreur.

La page inclut aussi un schéma texte fixe de l'architecture du pipeline (sources → scripts Python → Supabase → Next.js).

---

### 3.13 Paramètres marché (`/ceo/market-settings`)

**Objectif** : seul écran de configuration du dashboard — un tableau éditable, une ligne par pays, écrivant directement dans `market_settings`.

**Champs verrouillés (non éditables)** : `pays`, `devise_locale`, `delivery_model` (`external_11usd` ou `internal_real_cost`, Angola uniquement).

**Champs éditables par le CEO** :

| Champ | Rôle |
|---|---|
| `fx_to_usd` | Taux de change vers USD (saisie manuelle, jamais une source externe automatique) |
| `conf_pct` / `dr_pct` | Taux de confirmation/livraison de référence — repli utilisé seulement si aucune commande observée sur la période |
| `aov_override` | AOV simulé (optionnel) pour l'onglet Seuils — `NULL` = AOV réellement observé utilisé |
| `marge_plancher_t` | Marge plancher T (confidentiel CEO) |

Une colonne calculée en lecture seule affiche le frais de livraison local : badge "Field Cash (réel)" pour l'Angola, ou `(11 + 2) × fx_to_usd` converti en devise locale pour les 6 autres marchés.

---

## 4. Stockage des données — catalogue des tables Supabase

### 4.1 Configuration marché

**`market_settings`** — table pivot unique, un enregistrement par pays servi. Porte le taux de change, la devise, le modèle de livraison et les seuils de marge ; **aucun montant de commande n'y est stocké**.

Colonnes clés : `pays` (unique), `devise_locale`, `fx_to_usd` (numeric 18,6, saisie manuelle), `fx_updated_at`/`fx_updated_by`, `conf_pct`/`dr_pct` (nullable), `marge_plancher_t`, `delivery_model` (`external_11usd` / `internal_real_cost`), `aov_override` (nullable).

Le mapping pays → devise est verrouillé par une contrainte `check` en base (empêche par construction le bug historique "ClickMarket/Gabon affiché en AOA au lieu de XAF"). Colonnes supprimées au fil des migrations (ne plus chercher en base) : `cout_call_center_par_commande`, `cogs_produit`, `cogs_devise`, `taux_retour`, `frais_retour_local`.

### 4.2 Réseaux logistiques COD (une ligne = une commande/lead)

| Table | Réseau | Clé | Notes |
|---|---|---|---|
| `clickmarket_leads` | ClickMarket | `order_id` | statuts `confirmation_status`/`shipping_status`, dates WAT+1h |
| `coliscod_leads` | Coliscod Angola | `order_id` | même structure |
| `africod_congo_leads` | Africod Congo | `order_id` | même structure |
| `shipsen_leads` + `shipsen_orders` | Shipsen | `mongo_id` | leads (univers complet) + orders (sous-ensemble expédié) |
| `shiplead_leads` + `shiplead_orders` | ShipLead | `mongo_id` | même backend que Shipsen |
| `mlshipafrica_leads` + `mlshipafrica_orders` | MLShipAfrica | `mongo_id` | même backend, sans `warehouse_id` |
| `ikatchiexpress_orders` | Ikatchiexpress | `order_id` | table unique, pas de split leads/shippings |

`order_id` n'est **pas unique** sur `shipsen_orders`/`shiplead_orders` (une commande peut être réexpédiée après échec, créant un second enregistrement de shipping) — piège corrigé après avoir fait échouer ~70% des upserts en production.

### 4.3 Stock entrant (shipments fournisseur → warehouse)

`clickmarket_shipments`, `coliscod_shipments`, `africod_congo_shipments`, `shipsen_expeditions`, `shiplead_shipments`, `mlshipafrica_shipments` — une ligne par item de shipment : `product_name`, `shipment_date`, `arrival_date`, `source_country`, `quantity_sent`, `quantity_arrived`, `quantity_defected`, `status`. Alimentent le COGS (quantité expédiée × 15$/unité) et l'onglet Stock & Inventaire.

### 4.4 Publicité

- **`meta_ads_by_country`** — une ligne par (canal, pays, jour), unique sur `(channel, country, date)`. Colonnes : `spend`, `impressions`, `clicks`, `leads`, `cpl`, `ctr`.
- **`meta_ads_by_account`** — même granularité + `account_id`/`account_name`, unique sur `(channel, account_id, country, date)`.

### 4.5 Trésorerie / cash historique (legacy, lecture seule)

**`cash_holdings`** et **`cash_out_manual`** — anciennes tables de saisie manuelle ("cash chez qui", dépenses manuelles). Depuis le 2026-07-08, **plus aucune page n'écrit dans ces tables** (Trésorerie et Stock sont passées 100% lecture seule) — conservées pour l'historique, jamais lues par les calculs actuels.

### 4.6 Field Cash Angola (mini-app logistique interne)

Pas de fichier de schéma dédié dans le dossier `supabase/` (structure fournie directement par le CEO) :
- **`field_delivery_params`** `(country, currency)` — devise configurée par pays.
- **`field_deliveries`** `(country, delivery_date, agent, amount_collected, delivery_fee)` — une ligne par livraison physique réelle.
- **`field_charges`** `(country, charge_date, description, category, amount)` — charges externes ponctuelles.
- **`field_remittances`** `(country, remit_date, amount, method, status)` — rapatriements de cash ; seul `status = 'received'` réduit le cash détenu restant.

### 4.7 Stock (legacy)

**`inventory`** `(pays, produit, quantite_stock, delai_appro_jours, stock_securite, ventes_moyennes_jour_override)` — unique sur `(pays, produit)`. Passée en lecture seule depuis le 2026-07-08 côté page Stock, mais toujours consommée côté serveur par le moteur d'alertes du Copilot IA (seuil de réapprovisionnement calculé à la volée, jamais stocké).

### 4.8 Copilot / alertes

**`copilot_alert_thresholds`** — table à ligne unique (`id = 'default'`), pas de fichier de schéma dédié. Colonnes : `taux_rupture_stock_max_pct`, `dr_pct_drop_max_points`, `cash_non_rapatrie_max_usd`. Lecture par tout utilisateur authentifié, écriture réservée au CEO.

---

## 5. Glossaire des constantes métier

| Constante | Valeur | Fichier | Usage |
|---|---|---|---|
| `DELIVERY_FEE_USD` | 11 $ | `lib/marketSettings.ts` | Forfait de livraison de base, 6 pays externes |
| `CHARGE_FIXE_LIVRAISON_USD` | 2 $ | `lib/marketSettings.ts` | Charge fixe ajoutée (2026-08-05) — total 13 $/commande livrée |
| `COGS_PRODUCTION_UNIT_USD` | 7 $ | `lib/margin.ts` | Coût production, par unité expédiée |
| `COGS_SHIPPING_UNIT_USD` | 8 $ | `lib/margin.ts` | Coût transport fournisseur→warehouse, par unité expédiée (total COGS = 15 $/unité) |
| `AFFILIATE_PAYOUT_MAX_USD` | 9 $ | `lib/thresholds.ts` | Plafond de payout affilié par commande confirmée |
| `DAILY_TARGET_RENTABLE_LIVRAISONS` | 50 | `lib/copilot/bottleneck.ts` | Objectif directeur du Copilot IA (commandes livrées + rentables/jour) |
| `PAYOUT_ALERT_THRESHOLD_USD` | 10 $ | `app/ceo/crm-voralis/page.tsx` | Seuil d'alerte "coût élevé" sur le payout/commande confirmée d'un affilié |
| Commission agent Angola | 2 000 (devise locale) | `lib/fieldCashServer.ts` | Par livraison, extraite du cash détenu restant (affichage uniquement) |

---

## 6. Points d'attention pour toute évolution future

- **Jamais recoder une formule déjà centralisée** : frais de livraison → toujours `deliveryFeeLocal()` (`lib/marketSettings.ts`) ; marge → toujours `computeBaseMargin()`/`finalizeMargin()` (`lib/margin.ts`) ; agrégation réseaux → toujours `aggregateCodNetworksByCountry()` (`lib/profitability.ts`). Ces fonctions sont conçues comme source unique de vérité, réutilisées par Rentabilité, Trésorerie, Seuils et le Copilot IA.
- **Vérifier avant de créer ou de supprimer** un module/table : plusieurs tables historiques (`cash_holdings`, `cash_out_manual`, `inventory`) restent en base sans être lues par l'UI actuelle, mais peuvent l'être côté Copilot — grep le repo avant de considérer du code "mort".
- **Toute nouvelle devise/pays** doit être ajoutée à `CANONICAL_COUNTRIES` (`lib/countries.ts`) et à `market_settings`, jamais codée en dur dans une page ou un réseau spécifique.
- **Ce document doit être régénéré** après toute modification des formules de marge, des constantes métier, ou de l'architecture des onglets — il est daté et peut devenir obsolète (voir l'exemple vécu : le passage du forfait 11$→13$ n'avait pas été répercuté partout, causant des tests cassés avant d'être détecté).
