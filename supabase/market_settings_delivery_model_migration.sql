-- Migration additive sur market_settings — modèle de coût de livraison par pays.
-- Run this once in Supabase → SQL Editor.
--
-- Contexte (2026-07-08) : l'Angola opère désormais sa propre logistique interne (mini-app
-- "Field Cash Angola" : field_deliveries, field_charges, field_remittances, field_agent_days,
-- field_delivery_params) — ses frais de livraison réels (commissions agent/manager + carburant)
-- remplacent le forfait fixe de 11 USD/commande pour ce pays uniquement. Les 6 autres marchés
-- (prestataires externes ClickMarket/Coliscod/Africod Congo/Shipsen) restent sur le forfait fixe
-- 11 USD tout inclus (call center compris) — comportement inchangé, DELIVERY_FEE_USD toujours
-- seule source pour ces 6 pays (lib/marketSettings.ts).

alter table market_settings
  add column if not exists delivery_model text not null default 'external_11usd'
    check (delivery_model in ('external_11usd', 'internal_real_cost'));

update market_settings set delivery_model = 'internal_real_cost' where pays = 'Angola';