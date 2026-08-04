-- ShipLead integration schema (shippings — table shiplead_orders).
-- Run this once in Supabase → SQL Editor, APRÈS shiplead_leads_schema.sql.
-- Source : https://api.myshiplead.com/shippings/search.
-- Même plateforme backend que Shipsen (voir scripts/sync/shipsen_family_common.py) — schéma et
-- fonction KPI copiés de shipsen_schema.sql à l'identique (même architecture leads+shippings,
-- même logique confirmed_orders=confirmed+cancelled déjà validée sur Shipsen le 2026-07-31).
--
-- Vocabulaire de shipping.status audité en direct (~200 commandes, 2026-08-03) :
--   received, cancelled, shipped, prepared, queued, reprogrammed — sous-ensemble du vocabulaire
--   Shipsen (queued/received/reprogrammed/prepared/paid/processed/shipped/cancelled/refunded).
--   "paid"/"processed"/"refunded" pas encore observés sur cet échantillon mais gardés dans le
--   mapping livré/retourné par cohérence avec Shipsen (mêmes valeurs possibles côté backend).

create table if not exists shiplead_orders (
  mongo_id text primary key,                -- _id du SHIPPING (pas de l'order) — unique globalement
  order_id text not null,
  country text not null,
  currency text not null,
  warehouse_id text not null,
  customer_name text,
  customer_phone text,
  product_name text,
  quantity integer,
  unit_price numeric,
  total_price numeric not null default 0,
  status text not null,                     -- queued/received/reprogrammed/prepared/paid/processed/shipped/cancelled/refunded
  is_processed boolean not null default false,
  is_refunded boolean not null default false,
  source text,
  tracking_number text,
  shipping_date date,
  order_date timestamptz not null,
  created_at timestamptz,
  updated_at timestamptz,
  paid_at timestamptz,
  processed_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists shiplead_orders_warehouse_idx on shiplead_orders (warehouse_id);
create index if not exists shiplead_orders_country_idx on shiplead_orders (country);
create index if not exists shiplead_orders_order_date_idx on shiplead_orders (order_date);
create index if not exists shiplead_orders_warehouse_order_idx on shiplead_orders (warehouse_id, order_id);

alter table shiplead_orders enable row level security;

drop policy if exists "Allow read for authenticated users" on shiplead_orders;
create policy "Allow read for authenticated users"
  on shiplead_orders for select
  to authenticated
  using (true);

-- KPI par marché filtré par période — copie exacte de kpi_shipsen_marche_periode (même
-- plateforme, mêmes règles déjà validées : confirmed_orders/cancelled_orders sur updated_at
-- (pas order_date — un lead peut être confirmé longtemps après sa création), total_orders =
-- confirmed + cancelled (cohérent avec le "Total Orders" natif de cette famille de plateforme,
-- voir shipsen_schema.sql pour le détail de cette décision), revenu livré sur
-- coalesce(processed_at, paid_at) (l'argent n'existe que sur commande livrée et encaissée).
drop function if exists kpi_shiplead_marche_periode(date, date);
create or replace function kpi_shiplead_marche_periode(date_from date, date_to date)
returns table (
  country text,
  currency text,
  total_orders bigint,
  confirmed_orders bigint,
  confirmation_rate numeric,
  revenue_confirmed numeric,
  revenue_delivered numeric,
  cancelled_orders bigint,
  pending_orders bigint,
  en_attente bigint,
  annulees bigint,
  rupture_stock bigint,
  doublons bigint,
  retournees bigint,
  livres bigint,
  taux_livraison numeric,
  delai_1er_contact_heures numeric
)
language sql
security invoker
stable
as $$
  with leads as (
    select
      country,
      max(currency) as currency,
      count(*) filter (where status_name not in ('Confirmed', 'Cancelled')) as pending_orders,
      round(
        avg(
          extract(epoch from (coalesce(last_unreached_date, updated_at) - order_date)) / 3600.0
        ) filter (
          where unreached_count <= 1
            and (last_unreached_date is not null or updated_at is not null)
        ),
        1
      ) as delai_1er_contact_heures
    from shiplead_leads
    where order_date::date between date_from and date_to
    group by country
  ),
  confirmation as (
    select
      country,
      count(*) filter (where status_name = 'Confirmed') as confirmed_orders,
      count(*) filter (where status_name = 'Cancelled') as cancelled_orders,
      coalesce(sum(total_price) filter (where status_name = 'Confirmed'), 0) as revenue_confirmed
    from shiplead_leads
    where status_name in ('Confirmed', 'Cancelled')
      and updated_at::date between date_from and date_to
    group by country
  ),
  shipping_extra as (
    select
      country,
      count(*) filter (where status = 'refunded') as retournees
    from shiplead_orders
    where order_date::date between date_from and date_to
    group by country
  ),
  -- Fenêtre corrigée le 2026-08-04 (même bug identifié et corrigé côté Shipsen, voir
  -- shipsen_schema.sql pour le détail de la vérification en direct) : shipping_date, PAS
  -- coalesce(processed_at, paid_at) — ce dernier rattachait à tort des commandes EXPÉDIÉES un
  -- autre mois mais dont le statut avait basculé en processed/paid ce mois-ci. "received"
  -- volontairement PAS ajouté au filtre de statut (décision CEO, même raisonnement que Shipsen).
  revenu_livre as (
    select
      country,
      max(currency) as currency,
      count(*) as livres,
      coalesce(sum(total_price), 0) - 11 * count(*) as revenue_delivered
    from shiplead_orders
    where status in ('processed', 'delivered', 'paid')
      and shipping_date is not null
      and shipping_date::date between date_from and date_to
    group by country
  )
  select
    coalesce(l.country, c.country, x.country, r.country) as country,
    coalesce(l.currency, r.currency) as currency,
    coalesce(c.confirmed_orders, 0) + coalesce(c.cancelled_orders, 0) as total_orders,
    coalesce(c.confirmed_orders, 0) as confirmed_orders,
    round(
      100.0 * coalesce(c.confirmed_orders, 0) / nullif(coalesce(c.confirmed_orders, 0) + coalesce(c.cancelled_orders, 0), 0),
      1
    ) as confirmation_rate,
    coalesce(c.revenue_confirmed, 0) as revenue_confirmed,
    coalesce(r.revenue_delivered, 0) as revenue_delivered,
    coalesce(c.cancelled_orders, 0) as cancelled_orders,
    coalesce(l.pending_orders, 0) as pending_orders,
    coalesce(l.pending_orders, 0) as en_attente,
    coalesce(c.cancelled_orders, 0) as annulees,
    0 as rupture_stock,
    0 as doublons,
    coalesce(x.retournees, 0) as retournees,
    coalesce(r.livres, 0) as livres,
    round(
      100.0 * coalesce(r.livres, 0) / nullif(coalesce(c.confirmed_orders, 0) + coalesce(c.cancelled_orders, 0), 0),
      1
    ) as taux_livraison,
    l.delai_1er_contact_heures
  from leads l
  full outer join confirmation c on c.country = l.country
  full outer join shipping_extra x on x.country = coalesce(l.country, c.country)
  full outer join revenu_livre r on r.country = coalesce(l.country, c.country, x.country);
$$;

grant execute on function kpi_shiplead_marche_periode(date, date) to authenticated;
