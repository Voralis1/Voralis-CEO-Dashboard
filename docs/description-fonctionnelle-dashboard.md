# Dashboard CEO Voralis — Description Fonctionnelle

**Projet :** Plateforme de pilotage financier et opérationnel pour une activité e-commerce en paiement à la livraison (COD — Cash On Delivery)
**Entreprise :** FGMED / Naturala Lda
**Périmètre géographique :** 7 marchés africains (Angola, Gabon, Congo, Mali, Guinée, Sénégal, Côte d'Ivoire)

---

## 1. Contexte et problématique

Naturala Lda opère un modèle de vente en ligne où le client paie **en espèces à la livraison** (COD), sur sept marchés africains distincts. Ce modèle génère une chaîne complexe d'acteurs et de données :

- Des **campagnes publicitaires** (Meta Ads) génèrent des leads.
- Des **réseaux logistiques COD** (ClickMarket, Coliscod Angola, Africod Congo, Shipsen) et des **affiliés marketing** (via le CRM Voralis) transforment ces leads en commandes : confirmation téléphonique, puis tentative de livraison, puis encaissement réel.
- Chaque marché a sa **propre devise locale** (AOA, XAF, XOF, GNF) et son **propre réseau**.
- L'argent réellement gagné dépend d'une chaîne de coûts (produit, transport, retours, publicité ou commission d'affilié) qui n'est visible qu'après livraison **et** encaissement.

**Le problème que ce dashboard résout :** avant sa mise en place, il n'existait aucune vue consolidée et fiable permettant de répondre à des questions simples mais critiques pour le pilotage de l'entreprise :

- Quelle est la marge nette réelle par marché, une fois tous les coûts déduits ?
- Où est le goulot d'étranglement qui empêche d'atteindre un volume de commandes rentables suffisant ?
- Quel est le niveau de trésorerie réel (encaissé, détenu par des tiers, sorti) par pays ?
- Un budget publicitaire ou une grille de commission affilié est-il encore rentable, ou faut-il l'arrêter ?

Le dashboard CEO a été conçu pour répondre à ces questions **sans jamais fabriquer un chiffre** : quand une donnée n'existe pas dans les sources connectées, l'application le signale explicitement plutôt que d'afficher un zéro ou une estimation invisible.

---

## 2. Les quatre règles métier fondamentales

Toute la plateforme est construite autour de quatre règles non négociables, appliquées de façon identique sur chaque écran :

### Règle 1 — L'argent n'existe que sur commande livrée ET encaissée
Une commande "confirmée" par téléphone n'est qu'une étape du tunnel de vente (funnel) : elle ne représente **aucun argent réel** tant qu'elle n'est pas livrée et payée. Aucun indicateur financier de l'application n'est calculé sur la base des confirmations.

### Règle 2 — Tous les KPI monétaires sont calculés sur la base "livré + encaissé"
Chiffre d'affaires, marge, trésorerie : toujours au même stade du cycle de vie de la commande, jamais mélangé avec des données de funnel (leads, taux de confirmation), qui restent des indicateurs de diagnostic opérationnel.

### Règle 3 — Les devises ne sont jamais additionnées entre pays
Angola (AOA), Gabon/Congo (XAF), Mali/Sénégal/Côte d'Ivoire (XOF), Guinée (GNF) : chaque montant reste affiché dans sa devise locale. Toute comparaison entre pays passe par un **taux de change modifiable manuellement par le CEO** (jamais une API de change automatique), car c'est le CEO qui décide du taux de référence utilisé pour le pilotage.

### Règle 4 — Les frais de livraison sont un forfait fixe de 11 USD par commande
Ce montant, converti en devise locale via le taux de change du marché concerné, remplace tout ancien concept de frais variable. Il inclut désormais également le coût du centre d'appel (call center), qui n'est donc plus une ligne de coût séparée dans les calculs de marge.

---

## 3. Utilisateurs et niveaux d'accès

L'application distingue deux rôles, appliqués **côté serveur** (jamais un simple masquage visuel) :

| Rôle | Accès |
|---|---|
| **CEO** | Vue complète : marge nette, décomposition des coûts (COGS, retours), seuil de marge plancher confidentiel, tous les paramètres de marché |
| **Équipe (team)** | Vue opérationnelle : volumes, taux, plafonds d'action (ex. "CPL max à ne pas dépasser"), signal couleur (🟢/🟠/🔴) — **jamais** la marge, les coûts ou le seuil plancher, même via le chatbot IA |

L'authentification repose sur Supabase Auth ; le rôle de l'utilisateur est stocké côté serveur et ne peut pas être falsifié depuis le navigateur.

---

## 4. Présentation des modules

### 4.1 Trésorerie (page d'accueil)
Vue consolidée par pays de trois blocs :
- **Cash encaissé** : chiffre d'affaires livré, moins les frais de livraison forfaitaires.
- **Cash chez qui** : cash physiquement détenu par des tiers (livreurs, managers locaux) et pas encore remonté à l'entreprise — avec un statut de rapatriement (en attente / en cours / rapatrié).
- **Cash Out** : dépenses réelles (publicité, salaires locaux, autres frais, et désormais le payout affilié exact) par pays, pour connaître la sortie de trésorerie réelle sur la période.

### 4.2 Rentabilité
Calcule la marge nette par pays pour les deux canaux d'acquisition :
- **Media Buying Interne** (les 4 réseaux COD, alimentés par Meta Ads) : marge = revenu net de livraison − dépense publicitaire − coût produit − coût des retours.
- **Affiliés** (réseau CRM Voralis) : la marge reste partiellement incomplète tant que le chiffre d'affaires par affilié n'est pas exposé par le CRM — ce manque est signalé explicitement plutôt que masqué.

### 4.3 Seuils de rentabilité & plafonds d'acquisition
Le module le plus stratégique pour la prise de décision quotidienne : pour chaque marché, calcule le **CPL maximum** (coût par lead publicitaire à ne pas dépasser) et le **payout affilié maximum**, en fonction de la marge cible et d'un seuil de marge plancher confidentiel fixé par le CEO. Un code couleur (🟢 scale / 🟠 surveiller / 🔴 stop) compare le coût réel observé à ces plafonds. C'est ici qu'a été introduit le premier contrôle d'accès par rôle de l'application : l'équipe voit le plafond et le feu, jamais la marge sous-jacente.

### 4.4 Media Buying Interne
Suivi des dépenses et performances publicitaires Meta Ads par pays (clics, impressions, leads, CPL, CTR), filtrable par période.

### 4.5 Réseaux Logistiques / COD
Vue unifiée des quatre réseaux logistiques (ClickMarket, Coliscod Angola, Africod Congo, Shipsen), avec des colonnes strictement identiques d'un réseau à l'autre (leads, confirmations, livraisons, taux, chiffre d'affaires livré, ruptures de stock, doublons), pour permettre une comparaison directe entre réseaux et pays.

### 4.6 CRM Voralis / Affiliés
Classement des affiliés marketing et des pays par performance (taux de livraison, payout, coût par commande confirmée), avec un seuil d'alerte ajustable sur le coût du payout.

### 4.7 Stock & Inventaire
Suivi du stock physique par pays et par produit, avec un seuil de réapprovisionnement calculé automatiquement à partir des ventes moyennes réelles et des paramètres de délai d'approvisionnement — jamais stocké, toujours recalculé pour rester cohérent avec les vraies ventes.

### 4.8 Copilot IA & Centre d'alertes
Le module le plus avancé de la plateforme : un assistant conversationnel (propulsé par l'API Claude d'Anthropic) dont l'unique objectif est d'aider à atteindre **50 commandes livrées, encaissées et rentables par jour**. Il analyse l'ensemble du tunnel de vente (acquisition → confirmation → livraison → encaissement) pour identifier le goulot d'étranglement le plus impactant, et répond toujours sous la forme OÙ (marché/réseau concerné) / QUOI (action concrète) / IMPACT (gain estimé) — jamais un simple tableau de chiffres. Il respecte le même contrôle d'accès par rôle que le reste de l'application. En complément, un centre d'alertes proactives signale automatiquement les risques de rupture de stock, les dépassements de seuils CPL/payout, les baisses de taux de livraison et le cash non rapatrié au-delà d'un seuil configurable.

### 4.9 Paramètres marché
Écran réservé au CEO pour saisir, par pays : le taux de change, le coût produit, le taux de retour, les taux de confirmation/livraison de référence, et le seuil de marge plancher confidentiel. Chaque champ non renseigné reste explicitement "non renseigné" (jamais traité comme zéro).

### 4.10 Équipe & Sources
Gestion des accès utilisateurs et supervision de l'état des synchronisations de données (fréquence, dernière mise à jour, erreurs éventuelles) pour chaque source connectée.

---

## 5. Filtre de période global

Toutes les pages partagent un sélecteur de dates unique (aujourd'hui, 7 jours, 30 jours, mois en cours, mois précédent, ou période personnalisée). Ce filtre respecte une distinction essentielle : les indicateurs de **funnel** (leads, confirmations) sont filtrés sur la date de **création** de la commande, tandis que les indicateurs **financiers** (chiffre d'affaires, marge) sont filtrés sur la date de **livraison** — cohérent avec la règle 1.

---

## 6. Une philosophie de donnée honnête

Un principe transversal distingue ce dashboard d'un tableau de bord classique : **il ne comble jamais un vide de donnée par une estimation silencieuse**. Trois exemples de limites structurelles, assumées et signalées explicitement à l'utilisateur plutôt que masquées :

- Le délai avant le premier contact commercial n'est fourni par aucune source connectée.
- Les motifs d'annulation et de retour ne sont pas catégorisés par les réseaux.
- Le chiffre d'affaires par affilié individuel n'est pas exposé par le CRM Voralis, ce qui rend la marge affiliée structurellement incomplète.

Chacune de ces limites est visible à l'écran (badge "donnée manquante", info-bulle explicative) plutôt que remplacée par un zéro qui fausserait la décision.

---

## 7. Valeur apportée à l'entreprise

- **Décision basée sur l'argent réel**, pas sur des indicateurs de façade (taux de confirmation).
- **Comparabilité multi-pays** sans jamais fausser les montants par une conversion automatique non maîtrisée.
- **Détection proactive des dérives de rentabilité** (CPL, payout) avant qu'elles n'érodent la marge sur un marché entier.
- **Gain de temps pour le CEO** grâce au Copilot IA qui priorise l'action plutôt que de simplement afficher des chiffres.
- **Confidentialité respectée** : la marge et les coûts ne sont jamais exposés à l'équipe opérationnelle, y compris par l'assistant conversationnel.
