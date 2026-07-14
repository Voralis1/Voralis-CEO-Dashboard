-- Retire les champs de coût manuels de market_settings (2026-07-14, demande CEO).
-- Run once in Supabase → SQL Editor, après avoir déployé le code qui ne les lit plus
-- (lib/margin.ts, lib/thresholds.ts, app/ceo/market-settings/page.tsx).
--
-- cogs_produit/cogs_devise : le COGS ne se saisit plus manuellement — il vient désormais de la
-- même formule que "Cash Out par pays" en Trésorerie : (COGS_PRODUCTION_UNIT_USD +
-- COGS_SHIPPING_UNIT_USD) × quantité de produit physiquement expédiée sur la période (cf.
-- lib/margin.ts, lib/supabase/queries.ts::fetchQuantitySentByCountry).
--
-- taux_retour/frais_retour_local : retirés de la formule de marge (demande CEO) — le coût des
-- retours n'est plus déduit de margeNette.
alter table market_settings drop column if exists cogs_produit;
alter table market_settings drop column if exists cogs_devise;
alter table market_settings drop column if exists taux_retour;
alter table market_settings drop column if exists frais_retour_local;