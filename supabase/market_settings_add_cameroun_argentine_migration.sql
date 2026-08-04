-- Migration additive sur market_settings — ajout de 2 marchés (2026-08-04).
-- Run this once in Supabase → SQL Editor.
--
-- Contexte : Cameroun et Argentine sont apparus comme pays réellement servis par ShipLead
-- (voir scripts/sync/sync_shiplead.py) mais absents de market_settings — /profitability les
-- affichait donc jusqu'ici avec un badge "config manquante" (marge non calculable). Cette
-- migration les ajoute pour que le CEO puisse les configurer via /ceo/market-settings.
--
-- ⚠️ Devise Argentine (décision CEO, 2026-08-04) : la vraie devise argentine est le peso (ARS),
-- mais ShipLead rapporte ses commandes en "XOF" pour ce marché (erreur de configuration côté
-- ShipLead, pas la nôtre) — les montants total_price déjà stockés dans shiplead_leads/orders
-- pour ce pays sont donc en XOF, pas en ARS. Le CEO a choisi de garder XOF ici plutôt qu'ARS,
-- pour rester cohérent avec les valeurs déjà en base (mettre ARS afficherait des montants XOF
-- comme s'ils étaient des pesos, avec un taux de conversion USD complètement faux). La devise
-- étant verrouillée après création (non éditable dans /ceo/market-settings), ce choix est
-- durable — à revoir uniquement si ShipLead corrige un jour sa configuration de ce marché.
--
-- Cameroun reprend le taux XAF déjà utilisé pour Gabon/Congo (même zone monétaire CEMAC, même
-- devise réelle — pas une approximation). Argentine reprend le taux XOF déjà utilisé pour
-- Mali/Sénégal/Côte d'Ivoire/Burkina Faso, par pure cohérence avec les valeurs déjà stockées
-- (voir note ci-dessus) — PAS un vrai taux ARS/USD.

alter table market_settings drop constraint if exists market_settings_pays_check;
alter table market_settings add constraint market_settings_pays_check
  check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso', 'Maroc', 'Cameroun', 'Argentine'));

alter table market_settings drop constraint if exists market_settings_pays_devise_check;
alter table market_settings add constraint market_settings_pays_devise_check check (
  (pays = 'Angola' and devise_locale = 'AOA') or
  (pays in ('Gabon', 'Congo', 'Cameroun') and devise_locale = 'XAF') or
  (pays in ('Mali', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso', 'Argentine') and devise_locale = 'XOF') or
  (pays = 'Guinée' and devise_locale = 'GNF') or
  (pays = 'Maroc' and devise_locale = 'MAD')
);

-- fx_to_usd : À VÉRIFIER ET CORRIGER par le CEO via /ceo/market-settings avant tout calcul de
-- KPI monétaire pour ces 2 pays (même principe que le seed des marchés précédents).
insert into market_settings (pays, devise_locale, fx_to_usd)
values
  ('Cameroun', 'XAF', 700),
  ('Argentine', 'XOF', 700)
on conflict (pays) do nothing;
