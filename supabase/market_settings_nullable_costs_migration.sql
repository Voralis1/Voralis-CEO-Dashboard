-- Migration additive sur market_settings (voir market_settings_schema.sql pour la table
-- d'origine) — rend nullable les coûts/taux qui n'ont pas encore été saisis par le CEO, pour
-- distinguer "pas encore renseigné" (NULL) de "confirmé à zéro" (0). Nécessaire pour le moteur
-- de marge de /profitability et /ceo : un coût NULL doit afficher "donnée manquante", jamais
-- être traité comme 0 dans un calcul de marge (ça gonflerait faussement le résultat).

alter table market_settings
  alter column cogs_produit drop default,
  alter column cogs_produit drop not null,
  alter column cout_call_center_par_commande drop default,
  alter column cout_call_center_par_commande drop not null,
  alter column taux_retour drop default,
  alter column taux_retour drop not null,
  alter column conf_pct drop default,
  alter column conf_pct drop not null,
  alter column dr_pct drop default,
  alter column dr_pct drop not null;

-- Frais de retour par réseau — dépendance différée assumée (0 accepté explicitement pour ce
-- champ tant qu'il n'est pas précisé, contrairement aux autres qui doivent rester NULL).
alter table market_settings add column if not exists frais_retour_local numeric(18, 2);

-- Remet à NULL les 0 issus du seed initial (jamais réellement saisis par le CEO) — vérifié :
-- 7/7 lignes concernées, aucune n'a été éditée depuis la création (fx_updated_by est NULL
-- partout, updated_at == fx_updated_at du seed).
update market_settings
set cogs_produit = null,
    cout_call_center_par_commande = null,
    taux_retour = null,
    conf_pct = null,
    dr_pct = null
where cogs_produit = 0
  and cout_call_center_par_commande = 0
  and taux_retour = 0
  and conf_pct = 0
  and dr_pct = 0;
