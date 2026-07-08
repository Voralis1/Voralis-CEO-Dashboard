-- Migration additive sur market_settings (voir market_settings_schema.sql pour la table
-- d'origine) — supprime la colonne cout_call_center_par_commande.
--
-- Contexte : le 2026-07-06, le CEO a confirmé que le coût du call center est déjà inclus dans
-- les 11 USD/commande de frais de livraison fixe (DELIVERY_FEE_USD, lib/marketSettings.ts).
-- Depuis cette date, aucun code applicatif ne lit ce champ — vérifié par audit complet du repo
-- (grep sur "cout_call_center", "call_center", "callCenter" : plus aucune occurrence hors SQL
-- et commentaires historiques). La colonne n'a donc plus lieu d'exister : la garder aurait pu
-- laisser croire à tort qu'un coût call center séparé restait à saisir/soustraire quelque part,
-- ce qui aurait doublé ce coût (une fois via les 11 USD, une fois via cette colonne).

alter table market_settings
  drop column if exists cout_call_center_par_commande;