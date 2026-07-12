-- Migration additive sur market_settings — ajout de 2 marchés (2026-07).
-- Run this once in Supabase → SQL Editor.
--
-- Contexte : Burkina Faso rejoint le périmètre COD (déjà visible côté Meta Ads sous l'alias
-- "BF", mais jusqu'ici hors market_settings donc affiché en USD par défaut dans la Trésorerie —
-- cf. lib/treasury.ts, branche "pays hors périmètre COD"). Maroc n'a aucun réseau logistique
-- (ni market_settings) mais apparaît en dépense Meta Ads ("Maroc") et comme pays d'origine de
-- stock (source_country "Morocco" sur les expéditions) — il rejoint market_settings uniquement
-- pour avoir sa vraie devise (MAD) en Trésorerie au lieu de l'USD par défaut, avec
-- delivery_model par défaut ('external_11usd') qui restera sans effet tant qu'aucune commande
-- livrée ne lui est attribuée par les 4 réseaux logistiques (aucune aujourd'hui).
--
-- Les contraintes CHECK sur pays/devise_locale/pays↔devise verrouillaient la liste à 7 pays et
-- 4 devises (AOA/XAF/XOF/GNF) — il faut les étendre avant de pouvoir insérer ces lignes.

alter table market_settings drop constraint if exists market_settings_pays_check;
alter table market_settings add constraint market_settings_pays_check
  check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso', 'Maroc'));

alter table market_settings drop constraint if exists market_settings_devise_locale_check;
alter table market_settings add constraint market_settings_devise_locale_check
  check (devise_locale in ('AOA', 'XAF', 'XOF', 'GNF', 'MAD'));

alter table market_settings drop constraint if exists market_settings_pays_devise_check;
alter table market_settings add constraint market_settings_pays_devise_check check (
  (pays = 'Angola' and devise_locale = 'AOA') or
  (pays in ('Gabon', 'Congo') and devise_locale = 'XAF') or
  (pays in ('Mali', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso') and devise_locale = 'XOF') or
  (pays = 'Guinée' and devise_locale = 'GNF') or
  (pays = 'Maroc' and devise_locale = 'MAD')
);

-- fx_to_usd ci-dessous sont des estimations de départ (même principe que le seed des 7 marchés
-- d'origine) — À VÉRIFIER ET CORRIGER par le CEO via /ceo/market-settings avant tout calcul de
-- KPI monétaire pour ces 2 pays. Burkina Faso reprend le taux XOF déjà utilisé pour Mali/
-- Sénégal/Côte d'Ivoire (même zone monétaire UEMOA).
insert into market_settings (pays, devise_locale, fx_to_usd)
values
  ('Burkina Faso', 'XOF', 600),
  ('Maroc', 'MAD', 9.5)
on conflict (pays) do nothing;