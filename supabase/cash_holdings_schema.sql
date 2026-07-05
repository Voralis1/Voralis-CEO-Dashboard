-- "Cash chez qui" — cash physiquement détenu, pas encore rapatrié, chez chaque partenaire
-- logistique / manager local. Suivi interne, saisi manuellement par le CEO (aucune API externe
-- ne fournit cette donnée). La devise n'est PAS stockée ici : elle se dérive de
-- market_settings.pays à l'affichage (source unique, voir lib/countries.ts / lib/marketSettings.ts).
-- Run this once in Supabase → SQL Editor.

create table if not exists cash_holdings (
  id uuid primary key default gen_random_uuid(),
  entite text not null,              -- ex. "Motoboy Angola - João", "ClickMarket Gabon"
  pays text not null
    check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire')),
  montant_detenu numeric(18, 2) not null,
  date_derniere_remise date,
  statut_rapatriement text not null default 'en_attente'
    check (statut_rapatriement in ('en_attente', 'en_cours', 'rapatrie')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cash_holdings_pays_idx on cash_holdings (pays);

alter table cash_holdings enable row level security;

create policy "Allow read for authenticated users"
  on cash_holdings for select
  to authenticated
  using (true);

-- Pas de policy insert/update/delete pour "authenticated" : les écritures passent
-- exclusivement par l'API serveur (supabaseAdmin), via l'écran CEO sur /ceo.

drop trigger if exists cash_holdings_set_updated_at on cash_holdings;
create trigger cash_holdings_set_updated_at
  before update on cash_holdings
  for each row
  execute function set_updated_at(); -- fonction déjà créée par market_settings_schema.sql

grant select on cash_holdings to authenticated;
