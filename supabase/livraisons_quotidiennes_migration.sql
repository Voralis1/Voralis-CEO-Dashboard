-- Expose la date de livraison au niveau ligne (par pays × jour) pour les 4 réseaux logistiques.
-- Run this once in Supabase → SQL Editor.
--
-- Contexte : les RPC existantes (kpi_*_marche_periode) ne renvoient qu'un agrégat par pays sur
-- toute la période sélectionnée — la date de livraison (delivered_at / processed_at) existe déjà
-- dans les tables sources mais n'était exposée nulle part au niveau des résultats. Ces nouvelles
-- fonctions ne font AUCUN calcul de BFR (pas de délai, pas de fonds de roulement) : elles se
-- contentent de regrouper la même donnée déjà utilisée par ca_livre/revenue_delivered, mais par
-- jour au lieu de par période entière — pour que le futur module BFR puisse consommer une série
-- temporelle sans avoir à interroger les tables brutes directement.

create or replace function kpi_clickmarket_livraisons_quotidiennes(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  date_livraison date,
  livres bigint,
  ca_livre numeric
)
language sql
security invoker
stable
as $$
  select
    country_id,
    max(country_name) as country_name,
    delivered_at::date as date_livraison,
    count(*) as livres,
    coalesce(sum(total_price), 0) as ca_livre
  from clickmarket_leads
  where delivered_at is not null
    and delivered_at::date between date_from and date_to
  group by country_id, delivered_at::date;
$$;

create or replace function kpi_coliscod_livraisons_quotidiennes(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  date_livraison date,
  livres bigint,
  ca_livre numeric
)
language sql
security invoker
stable
as $$
  select
    country_id,
    max(country_name) as country_name,
    delivered_at::date as date_livraison,
    count(*) as livres,
    coalesce(sum(total_price), 0) as ca_livre
  from coliscod_leads
  where delivered_at is not null
    and delivered_at::date between date_from and date_to
  group by country_id, delivered_at::date;
$$;

create or replace function kpi_africod_congo_livraisons_quotidiennes(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  date_livraison date,
  livres bigint,
  ca_livre numeric
)
language sql
security invoker
stable
as $$
  select
    country_id,
    max(country_name) as country_name,
    delivered_at::date as date_livraison,
    count(*) as livres,
    coalesce(sum(total_price), 0) as ca_livre
  from africod_congo_leads
  where delivered_at is not null
    and delivered_at::date between date_from and date_to
  group by country_id, delivered_at::date;
$$;

-- Shipsen n'a pas de delivered_at propre : processed_at fait office de date de livraison
-- (même convention que kpi_shipsen_marche_periode, voir shipsen_schema.sql).
create or replace function kpi_shipsen_livraisons_quotidiennes(date_from date, date_to date)
returns table (
  country text,
  currency text,
  date_livraison date,
  livres bigint,
  revenue_delivered numeric
)
language sql
security invoker
stable
as $$
  select
    country,
    max(currency) as currency,
    processed_at::date as date_livraison,
    count(*) as livres,
    coalesce(sum(total_price), 0) as revenue_delivered
  from shipsen_orders
  where is_processed = true
    and not is_refunded
    and processed_at is not null
    and processed_at::date between date_from and date_to
  group by country, processed_at::date;
$$;

grant execute on function kpi_clickmarket_livraisons_quotidiennes(date, date) to authenticated;
grant execute on function kpi_coliscod_livraisons_quotidiennes(date, date) to authenticated;
grant execute on function kpi_africod_congo_livraisons_quotidiennes(date, date) to authenticated;
grant execute on function kpi_shipsen_livraisons_quotidiennes(date, date) to authenticated;