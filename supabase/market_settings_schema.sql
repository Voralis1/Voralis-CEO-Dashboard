-- Fondation "paramètres marché" — source unique de vérité pour le FX et les coûts.
-- Run this once in Supabase → SQL Editor.
--
-- Règles métier encodées ici (voir aussi lib/countries.ts et lib/marketSettings.ts) :
--   1. L'argent n'existe que sur une commande livrée ET encaissée — cette table ne stocke
--      aucun montant de commande, uniquement des paramètres/coûts de référence.
--   2. Les devises ne sont jamais additionnées entre pays — fx_to_usd est manuel/éditable,
--      jamais déduit d'une conversion automatique.
--   3. Le mapping pays -> devise_locale est verrouillé par le check constraint ci-dessous :
--      il ne doit plus jamais être possible d'assigner une devise incorrecte à un pays
--      (cf. bug ClickMarket/Gabon affiché en AOA au lieu de XAF).
--   4. Les frais de livraison (11 USD fixe, tous pays confondus) ne sont PAS stockés ici :
--      c'est une constante globale (DELIVERY_FEE_USD dans lib/marketSettings.ts), convertie
--      à la volée via fx_to_usd de cette table.

create table if not exists market_settings (
  id                             uuid primary key default gen_random_uuid(),

  pays                           text not null unique
    check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire')),

  devise_locale                  text not null
    check (devise_locale in ('AOA', 'XAF', 'XOF', 'GNF')),

  -- Mapping devise verrouillé (validé avec le CEO) : impossible d'assigner une devise
  -- incohérente à un pays au niveau de la base, quel que soit le code applicatif.
  constraint market_settings_pays_devise_check check (
    (pays = 'Angola' and devise_locale = 'AOA') or
    (pays in ('Gabon', 'Congo') and devise_locale = 'XAF') or
    (pays in ('Mali', 'Sénégal', 'Côte d''Ivoire') and devise_locale = 'XOF') or
    (pays = 'Guinée' and devise_locale = 'GNF')
  ),

  -- Taux de change USD -> devise_locale. MANUEL, éditable par le CEO via /ceo/market-settings.
  -- Ne jamais déduire ce champ d'une source externe automatique : c'est la valeur de
  -- référence pour toutes les conversions du dashboard (voir règle 2).
  fx_to_usd                      numeric(18, 6) not null check (fx_to_usd > 0),
  fx_updated_at                  timestamptz not null default now(),
  fx_updated_by                  text,

  -- Coût produit — cogs_devise précise si cogs_produit est exprimé en USD ou en devise_locale,
  -- pour éviter toute ambiguïté de conversion.
  cogs_produit                   numeric(18, 2) not null default 0,
  cogs_devise                    text not null default 'USD' check (cogs_devise in ('USD', 'local')),

  -- Coût call center par commande, en devise_locale.
  cout_call_center_par_commande  numeric(18, 2) not null default 0,

  -- Taux en pourcentage (0-100).
  taux_retour                    numeric(5, 2) not null default 0 check (taux_retour between 0 and 100),
  conf_pct                       numeric(5, 2) not null default 0 check (conf_pct between 0 and 100),
  dr_pct                         numeric(5, 2) not null default 0 check (dr_pct between 0 and 100),

  -- Seuil de marge plancher, en devise_locale — CONFIDENTIEL CEO.
  marge_plancher_t               numeric(18, 2) not null default 0,

  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

alter table market_settings enable row level security;

-- Lecture : réservée aux utilisateurs authentifiés (même politique que les autres tables
-- du projet, ex. clickmarket_leads) — pas d'accès anonyme/public.
create policy "Allow read for authenticated users"
  on market_settings for select
  to authenticated
  using (true);

-- Pas de policy insert/update/delete pour "authenticated" : les écritures passent
-- exclusivement par l'API serveur (supabaseAdmin, rôle service_role qui bypass RLS),
-- via l'écran d'administration CEO (/ceo/market-settings). Ça garde marge_plancher_t
-- et les FX modifiables uniquement depuis un point d'entrée serveur contrôlé.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists market_settings_set_updated_at on market_settings;
create trigger market_settings_set_updated_at
  before update on market_settings
  for each row
  execute function set_updated_at();

-- Seed des 7 marchés. fx_to_usd ci-dessous sont des estimations de départ — À VÉRIFIER ET
-- CORRIGER par le CEO via l'écran d'administration avant tout calcul de KPI monétaire.
-- Les taux, coûts et seuils (taux_retour, conf_pct, dr_pct, cout_call_center_par_commande,
-- cogs_produit, marge_plancher_t) sont initialisés à 0 et doivent être renseignés par le CEO.
insert into market_settings (pays, devise_locale, fx_to_usd)
values
  ('Angola', 'AOA', 830),
  ('Gabon', 'XAF', 600),
  ('Congo', 'XAF', 600),
  ('Mali', 'XOF', 600),
  ('Guinée', 'GNF', 8600),
  ('Sénégal', 'XOF', 600),
  ('Côte d''Ivoire', 'XOF', 600)
on conflict (pays) do nothing;

grant select on market_settings to authenticated;
