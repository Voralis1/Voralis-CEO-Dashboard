-- Africod Congo (AfriqueCOD, marché Congo) integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.afriquecod.com/api/orders-paginated (X-Selected-Country: {"id":17,"name":"Congo","currency":"XAF",...})

create table if not exists africod_congo_leads (
  order_id text primary key,               -- business reference, e.g. "AOD-xxxxx"
  internal_id bigint,                       -- AfricaCOD's numeric `id`
  country_id integer not null,
  country_name text not null,               -- denormalized from order.country.name
  customer_name text,
  customer_phone text,
  customer_city text,
  total_price numeric not null default 0,
  quantity integer,
  confirmation_status text,                 -- order.confirmation_status.name (e.g. "confirmed", "remind")
  shipping_status text,                     -- order.shipping_status.name
  seller_payment_status text,               -- "paid" / "unpaid"
  product_name text,                        -- order.order_items[0].product.name
  confirmation_agent text,                  -- order.confirmation_agent.username
  order_date date not null,
  order_created_at timestamptz,             -- order.created_at (AfricaCOD side)
  confirmed_at timestamptz,
  delivered_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists africod_congo_leads_country_idx on africod_congo_leads (country_id);
create index if not exists africod_congo_leads_order_date_idx on africod_congo_leads (order_date);

alter table africod_congo_leads enable row level security;

create policy "Allow read for authenticated users"
  on africod_congo_leads for select
  to authenticated
  using (true);

-- KPI par marché (pays), calcul instantané côté Postgres.
-- security_invoker = true : la vue respecte les policies RLS de africod_congo_leads
-- au lieu de s'exécuter avec les droits du propriétaire de la vue.
create or replace view kpi_africod_congo_marche
  with (security_invoker = true) as
select
  country_id,
  max(country_name) as country_name,
  count(*) as total_leads,
  count(*) filter (where confirmation_status = 'confirmed') as confirmes,
  round(
    100.0 * count(*) filter (where confirmation_status = 'confirmed') / nullif(count(*), 0),
    1
  ) as taux_confirmation,
  count(*) filter (where delivered_at is not null) as livres,
  round(
    100.0 * count(*) filter (where delivered_at is not null)
      / nullif(count(*) filter (where confirmation_status = 'confirmed'), 0),
    1
  ) as taux_livraison,
  coalesce(sum(total_price) filter (where delivered_at is not null), 0) as ca_livre
from africod_congo_leads
group by country_id;

-- Variante filtrée par période, pour respecter le sélecteur de dates du dashboard (De / À).
-- Utilisation : select * from kpi_africod_congo_marche_periode('2026-06-01', '2026-06-30');
create or replace function kpi_africod_congo_marche_periode(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  total_leads bigint,
  confirmes bigint,
  taux_confirmation numeric,
  livres bigint,
  taux_livraison numeric,
  ca_livre numeric
)
language sql
security invoker
stable
as $$
  select
    country_id,
    max(country_name) as country_name,
    count(*) as total_leads,
    count(*) filter (where confirmation_status = 'confirmed') as confirmes,
    round(100.0 * count(*) filter (where confirmation_status = 'confirmed') / nullif(count(*), 0), 1) as taux_confirmation,
    count(*) filter (where delivered_at is not null) as livres,
    round(
      100.0 * count(*) filter (where delivered_at is not null)
        / nullif(count(*) filter (where confirmation_status = 'confirmed'), 0),
      1
    ) as taux_livraison,
    coalesce(sum(total_price) filter (where delivered_at is not null), 0) as ca_livre
  from africod_congo_leads
  where order_date between date_from and date_to
  group by country_id;
$$;

grant select on kpi_africod_congo_marche to authenticated;
grant execute on function kpi_africod_congo_marche_periode(date, date) to authenticated;
