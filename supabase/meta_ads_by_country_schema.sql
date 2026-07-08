-- Documente le schéma de meta_ads_by_country — table qui existe déjà en production (source :
-- API Meta Ads, sync n8n quotidienne) mais qui n'était versionnée dans aucun fichier du repo.
-- Run this once in Supabase → SQL Editor.
--
-- `create table if not exists` est un no-op si la table existe déjà : ce fichier documente le
-- schéma déduit du code applicatif (lib/supabase/queries.ts, interface MetaAdsCountryRow) et
-- des commentaires historiques ("une ligne par pays/canal/jour, avec une vraie colonne date
-- réelle, confirmé le 2026-07-06"). À réconcilier avec le schéma réel (\d meta_ads_by_country
-- dans Supabase) si les types ci-dessous ne correspondent pas exactement à la table existante.

create table if not exists meta_ads_by_country (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  country text not null,
  date date not null,
  spend numeric(18, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads bigint not null default 0,
  cpl numeric(18, 4),
  ctr numeric(9, 4),
  created_at timestamptz not null default now(),
  unique (channel, country, date)
);

create index if not exists meta_ads_by_country_date_idx on meta_ads_by_country (date);

alter table meta_ads_by_country enable row level security;

create policy "Allow read for authenticated users"
  on meta_ads_by_country for select
  to authenticated
  using (true);

grant select on meta_ads_by_country to authenticated;