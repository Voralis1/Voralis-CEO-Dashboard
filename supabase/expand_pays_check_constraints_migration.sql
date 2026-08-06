-- Aligne les contraintes CHECK(pays) de cash_holdings, cash_out_manual et inventory sur la
-- liste complète des marchés désormais suivis dans market_settings (2026-08-06).
-- Run this once in Supabase → SQL Editor, APRÈS market_settings_add_centrafrique_migration.sql.
--
-- Contexte : market_settings a été étendu au fil du temps (Burkina Faso, Maroc, Cameroun,
-- Argentine, puis Centrafrique) mais ces 3 autres tables sont restées bloquées sur les 7 marchés
-- d'origine (check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal',
-- 'Côte d''Ivoire'))) — vérifié en direct le 2026-08-06 : une tentative d'insertion pour
-- "Burkina Faso" dans cash_holdings échoue avec "violates check constraint
-- cash_holdings_pays_check". Aucune page n'écrit plus dans ces 3 tables aujourd'hui (Trésorerie
-- et Stock & Inventaire sont passées en lecture seule le 2026-07-08), donc ce n'est pas un bug
-- actif côté utilisateur, mais un piège latent pour toute réutilisation future (API directe,
-- nouvelle fonctionnalité) — corrigé ici par cohérence avec market_settings plutôt que d'attendre
-- l'incident.

alter table cash_holdings drop constraint if exists cash_holdings_pays_check;
alter table cash_holdings add constraint cash_holdings_pays_check
  check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso', 'Maroc', 'Cameroun', 'Argentine', 'Centrafrique'));

alter table cash_out_manual drop constraint if exists cash_out_manual_pays_check;
alter table cash_out_manual add constraint cash_out_manual_pays_check
  check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso', 'Maroc', 'Cameroun', 'Argentine', 'Centrafrique'));

alter table inventory drop constraint if exists inventory_pays_check;
alter table inventory add constraint inventory_pays_check
  check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire', 'Burkina Faso', 'Maroc', 'Cameroun', 'Argentine', 'Centrafrique'));
