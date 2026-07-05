-- Module "Seuils de rentabilité & plafonds d'acquisition" — ajoute une surcharge CEO
-- optionnelle pour SIMULER un AOV différent ("et si l'AOV était de X ?"). NULL (cas normal)
-- = le module utilise l'AOV réellement observé (CA livré encaissé ÷ livrées, même base que
-- /profitability) — pas de saisie manuelle par défaut, pour ne pas créer deux sources
-- divergentes pour la même donnée.
alter table market_settings add column if not exists aov_override numeric(18, 2);
