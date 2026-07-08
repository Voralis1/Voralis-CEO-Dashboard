-- Colonnes "en attente" pour les 3 flux de cash sans date métier fiable aujourd'hui (audit du
-- 2026-07-07). Toutes NULLABLE, sans défaut — NULL = "source pas encore branchée", jamais une
-- date implicite (ex. now()) qui ferait croire à tort qu'un encaissement/rapatriement/réception a
-- eu lieu. Ce lot prépare uniquement la structure d'accueil : aucune logique BFR n'est codée ici,
-- et rien ne peuple ces colonnes tant qu'une source vivante n'est pas branchée dessus.
-- Run this once in Supabase → SQL Editor.

-- Flux 5 — encaissement effectif : le moment où le cash COD est réellement collecté par le
-- livreur/CRM, distinct de delivered_at (ClickMarket/Coliscod/Africod Congo) et de processed_at
-- (Shipsen) — voir règle métier : livraison, encaissement et rapatriement sont 3 moments distincts.
alter table clickmarket_leads add column if not exists encaisse_at timestamptz;
alter table coliscod_leads add column if not exists encaisse_at timestamptz;
alter table africod_congo_leads add column if not exists encaisse_at timestamptz;
alter table shipsen_orders add column if not exists encaisse_at timestamptz;

-- Flux 6 — rapatriement effectif : distinct de date_derniere_remise (ambiguë, ne garantit pas
-- que le cash a été crédité en trésorerie centrale) et de updated_at (technique, change à chaque
-- modification de la ligne, pas seulement au rapatriement).
alter table cash_holdings add column if not exists date_rapatriement_effectif timestamptz;

-- Flux 3 — achat/réception de stock : inventory ne modélise qu'un état courant (quantite_stock),
-- pas un journal de mouvements. Ce champ est un point d'accueil pour "dernière réception connue"
-- si une source vivante est branchée un jour — pas un historique complet des achats.
alter table inventory add column if not exists date_derniere_reception timestamptz;