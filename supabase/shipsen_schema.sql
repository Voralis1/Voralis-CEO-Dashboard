-- Shipsen integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.shipsen.com/orders/search

create table if not exists shipsen_orders (
  -- mongo_id ("_id") is the primary key, NOT order_id: Shipsen's readable "id" is only
  -- unique per warehouse (each warehouse has its own numbering), so the same order_id
  -- value can legitimately show up in two different countries and collide on upsert.
  mongo_id text primary key,                -- Shipsen's Mongo "_id" — globally unique
  order_id text not null,                   -- Shipsen's readable order id ("id" field)
  country text not null,                    -- denormalized from order.warehouse.country
  currency text not null,                   -- denormalized from order.warehouse.currency
  warehouse_id text not null,
  customer_name text,
  customer_phone text,
  customer_city text,
  product_name text,                        -- order.details[0].productName
  quantity integer,
  unit_price numeric,
  total_price numeric not null default 0,
  status text not null,                     -- order.status.name ("Pending" / "Confirmed" / "Cancelled" / ...)
  is_processed boolean not null default false,
  is_refunded boolean not null default false,
  source text,
  order_date timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  paid_at timestamptz,
  processed_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists shipsen_orders_warehouse_idx on shipsen_orders (warehouse_id);
create index if not exists shipsen_orders_country_idx on shipsen_orders (country);
create index if not exists shipsen_orders_order_date_idx on shipsen_orders (order_date);

-- order_id est unique PAR warehouse (pas globalement) — cette contrainte le garantit
-- sans supposer qu'il l'est aussi entre pays.
create unique index if not exists shipsen_orders_warehouse_order_idx
  on shipsen_orders (warehouse_id, order_id);

alter table shipsen_orders enable row level security;

create policy "Allow read for authenticated users"
  on shipsen_orders for select
  to authenticated
  using (true);

-- KPI par pays. security_invoker = true : la vue respecte les policies RLS
-- de shipsen_orders au lieu de s'exécuter avec les droits du propriétaire.
-- Les revenus restent groupés par devise (currency) : on ne convertit/additionne
-- jamais XOF et GNF entre eux.
create or replace view shipsen_kpi_by_country
  with (security_invoker = true) as
select
  country,
  max(currency) as currency,
  count(*) as total_orders,
  count(*) filter (where status = 'Confirmed') as confirmed_orders,
  round(
    100.0 * count(*) filter (where status = 'Confirmed') / nullif(count(*), 0),
    1
  ) as confirmation_rate,
  coalesce(sum(total_price) filter (where status = 'Confirmed'), 0) as revenue_confirmed,
  coalesce(sum(total_price) filter (where is_processed = true), 0) as revenue_delivered,
  count(*) filter (where status = 'Cancelled') as cancelled_orders,
  count(*) filter (where status = 'Pending') as pending_orders
from shipsen_orders
group by country;

-- KPI global, tous pays confondus. Uniquement des COMPTES de commandes :
-- pas de revenu global, puisque les devises (XOF / GNF) ne sont pas additionnables.
create or replace view shipsen_kpi_global
  with (security_invoker = true) as
select
  count(*) filter (where status = 'Confirmed') as total_confirmed_orders,
  count(*) as total_orders_all,
  round(
    100.0 * count(*) filter (where status = 'Confirmed') / nullif(count(*), 0),
    1
  ) as global_confirmation_rate
from shipsen_orders;

grant select on shipsen_kpi_by_country to authenticated;
grant select on shipsen_kpi_global to authenticated;

-- Variantes filtrées par période, pour respecter le sélecteur de dates du dashboard (De / À).
-- Utilisation : select * from kpi_shipsen_marche_periode('2026-06-01', '2026-06-30');
create or replace function kpi_shipsen_marche_periode(date_from date, date_to date)
returns table (
  country text,
  currency text,
  total_orders bigint,
  confirmed_orders bigint,
  confirmation_rate numeric,
  revenue_confirmed numeric,
  revenue_delivered numeric,
  cancelled_orders bigint,
  pending_orders bigint
)
language sql
security invoker
stable
as $$
  select
    country,
    max(currency) as currency,
    count(*) as total_orders,
    count(*) filter (where status = 'Confirmed') as confirmed_orders,
    round(
      100.0 * count(*) filter (where status = 'Confirmed') / nullif(count(*), 0),
      1
    ) as confirmation_rate,
    coalesce(sum(total_price) filter (where status = 'Confirmed'), 0) as revenue_confirmed,
    coalesce(sum(total_price) filter (where is_processed = true), 0) as revenue_delivered,
    count(*) filter (where status = 'Cancelled') as cancelled_orders,
    count(*) filter (where status = 'Pending') as pending_orders
  from shipsen_orders
  where order_date::date between date_from and date_to
  group by country;
$$;

create or replace function kpi_shipsen_global_periode(date_from date, date_to date)
returns table (
  total_confirmed_orders bigint,
  total_orders_all bigint,
  global_confirmation_rate numeric
)
language sql
security invoker
stable
as $$
  select
    count(*) filter (where status = 'Confirmed') as total_confirmed_orders,
    count(*) as total_orders_all,
    round(
      100.0 * count(*) filter (where status = 'Confirmed') / nullif(count(*), 0),
      1
    ) as global_confirmation_rate
  from shipsen_orders
  where order_date::date between date_from and date_to;
$$;

grant execute on function kpi_shipsen_marche_periode(date, date) to authenticated;
grant execute on function kpi_shipsen_global_periode(date, date) to authenticated;
