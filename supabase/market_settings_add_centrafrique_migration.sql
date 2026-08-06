-- Migration additive sur market_settings — ajout de la Centrafrique (2026-08-06).
-- Run this once in Supabase → SQL Editor.
--
-- Contexte : Centrafrique est apparue via le CRM Voralis (/api/v1/reports/orders, commandes
-- affiliées) avec un volume réel (480+ commandes, cf. lib/countries.ts) mais était absente de
-- market_settings — audit du 2026-08-06 a montré que tout module qui boucle sur
-- market_settings comme liste maîtresse des marchés (Trésorerie, Rentabilité, Seuils, Copilot IA,
-- l'onglet Stock & Inventaire, /api/dashboard/timeseries) ignorait donc silencieusement ce
-- marché, malgré la politique CEO du 2026-08-04 ("tout nouveau pays avec un volume de commandes
-- réel doit être pris en compte immédiatement, sans attendre une validation"). Seul
-- lib/affiliates.ts s'en sortait, en réutilisant le taux XAF déjà suivi pour Cameroun/Congo/Gabon
-- pour convertir le payout affilié — cette migration donne à Centrafrique sa propre ligne, pour
-- que TOUS les modules la traitent, pas seulement le calcul de payout affilié.
--
-- Centrafrique reprend le taux XAF déjà utilisé pour Gabon/Congo/Cameroun (même zone monétaire
-- CEMAC, même devise réelle — pas une approximation).

alter table market_settings drop constraint if exists market_settings_pays_check;
alter table market_settings add constraint market_settings_pays_check
  check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso', 'Maroc', 'Cameroun', 'Argentine', 'Centrafrique'));

alter table market_settings drop constraint if exists market_settings_pays_devise_check;
alter table market_settings add constraint market_settings_pays_devise_check check (
  (pays = 'Angola' and devise_locale = 'AOA') or
  (pays in ('Gabon', 'Congo', 'Cameroun', 'Centrafrique') and devise_locale = 'XAF') or
  (pays in ('Mali', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso', 'Argentine') and devise_locale = 'XOF') or
  (pays = 'Guinée' and devise_locale = 'GNF') or
  (pays = 'Maroc' and devise_locale = 'MAD')
);

-- fx_to_usd : reprend la valeur XAF actuellement en vigueur pour Gabon/Congo/Cameroun (700 au
-- 2026-08-06) — À VÉRIFIER ET CORRIGER par le CEO via /ceo/market-settings si ce taux a divergé
-- depuis (même principe que le seed des marchés précédents).
insert into market_settings (pays, devise_locale, fx_to_usd)
values
  ('Centrafrique', 'XAF', 700)
on conflict (pays) do nothing;
