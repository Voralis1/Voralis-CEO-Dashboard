-- Documente le schéma de meta_ads_by_account — table qui existe déjà en production (source :
-- API Meta Ads, sync n8n quotidienne jusqu'au 2026-08-04, remplacée par scripts/sync/sync_meta_ads.py)
-- mais qui n'était versionnée dans aucun fichier du repo. Run this once in Supabase → SQL Editor.
--
-- `create table if not exists` est un no-op si la table existe déjà : ce fichier documente le
-- schéma déduit du code applicatif (lib/supabase/queries.ts, interface MetaAdsAccountRow) et
-- de l'introspection directe de la table (colonnes/contraintes réelles, 2026-08-04).

create table if not exists meta_ads_by_account (
  id bigint generated always as identity primary key,
  channel text not null default 'meta',
  account_id text not null,
  account_name text,
  country text not null,
  date date not null,
  spend numeric(18, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads bigint not null default 0,
  row_count integer not null default 0,
  cpl numeric(18, 4),
  ctr numeric(9, 4),
  updated_at timestamptz not null default now(),
  unique (channel, account_id, country, date)
);

create index if not exists meta_ads_by_account_date_idx on meta_ads_by_account (date);

alter table meta_ads_by_account enable row level security;

create policy "Allow read for authenticated users"
  on meta_ads_by_account for select
  to authenticated
  using (true);

grant select on meta_ads_by_account to authenticated;
