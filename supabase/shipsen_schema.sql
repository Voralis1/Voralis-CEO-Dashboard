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
-- Le funnel (total_orders/confirmed_orders/confirmation_rate/cancelled/pending) reste basé sur
-- la date de CRÉATION (order_date). Seul revenue_delivered bascule sur la date de TRAITEMENT
-- (processed_at = livraison), conformément à la règle "l'argent n'existe que sur commande
-- livrée et encaissée" — même logique que ClickMarket/Coliscod/Africod Congo (FULL OUTER JOIN
-- pour ne pas perdre un pays qui n'a livré que des commandes créées hors fenêtre).
-- revenue_confirmed reste filtré sur order_date : shipsen_orders n'a pas de colonne
-- confirmed_at, donc il n'existe pas de vraie date de confirmation à utiliser ici. C'est une
-- limite de données connue — et un problème de fond distinct (une commande "confirmée" n'est
-- de toute façon pas censée nourrir un KPI de revenu, cf. règle 1), non traité dans ce lot.
-- Utilisation : select * from kpi_shipsen_marche_periode('2026-06-01', '2026-06-30');
-- Extension : en_attente/annulees/rupture_stock/doublons/retournees, ajoutés pour le tableau
-- prestataire partagé (colonnes strictement identiques sur les 4 réseaux). Mapping validé sur
-- données réelles (audit des valeurs distinctes de status) :
--   - doublons        : status = 'Double' (exclu du calcul des taux, affiché à part)
--   - rupture_stock   : pas de notion de rupture de stock chez Shipsen — colonne à 0
--   - annulees        : status in ('Cancelled','Expired') — 'Expired' n'était compté nulle part
--                       avant (ni dans cancelled_orders, ni ailleurs), corrigé ici
--   - en_attente      : ni livré, ni annulé/expiré, ni doublon (inclut Pending, "En attente de
--                       dépot", Unreached, Confirmed-pas-encore-traité)
--   - retournees      : is_refunded = true — colonne réelle mais jamais renseignée à ce jour
--                       (100% false observé) ; revenue_delivered exclut désormais explicitement
--                       les commandes remboursées (and not is_refunded), sans impact actuel
--                       puisque ce champ est toujours false, mais correct si ça change.
--   - livres/taux_livraison : Shipsen n'exposait aucun COMPTAGE de commandes livrées (seulement
--                       la somme revenue_delivered) — ajouté ici pour que "Livrées" existe sur
--                       les 4 réseaux, même définition (is_processed, hors remboursées, filtré
--                       sur processed_at) que revenue_delivered.
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
  pending_orders bigint,
  en_attente bigint,
  annulees bigint,
  rupture_stock bigint,
  doublons bigint,
  retournees bigint,
  livres bigint,
  taux_livraison numeric
)
language sql
security invoker
stable
as $$
  with funnel as (
    select
      country,
      max(currency) as currency,
      count(*) as total_orders,
      count(*) filter (where status = 'Confirmed') as confirmed_orders,
      round(100.0 * count(*) filter (where status = 'Confirmed') / nullif(count(*), 0), 1) as confirmation_rate,
      coalesce(sum(total_price) filter (where status = 'Confirmed'), 0) as revenue_confirmed,
      count(*) filter (where status = 'Cancelled') as cancelled_orders,
      count(*) filter (where status = 'Pending') as pending_orders,
      count(*) filter (where status = 'Double') as doublons,
      count(*) filter (where status in ('Cancelled', 'Expired')) as annulees,
      count(*) filter (where is_refunded) as retournees,
      count(*) filter (
        where not is_processed
          and status not in ('Cancelled', 'Expired', 'Double')
      ) as en_attente
    from shipsen_orders
    where order_date::date between date_from and date_to
    group by country
  ),
  revenu_livre as (
    select
      country,
      max(currency) as currency,
      count(*) as livres,
      coalesce(sum(total_price), 0) as revenue_delivered
    from shipsen_orders
    where is_processed = true
      and not is_refunded
      and processed_at is not null
      and processed_at::date between date_from and date_to
    group by country
  )
  select
    coalesce(f.country, r.country) as country,
    coalesce(f.currency, r.currency) as currency,
    coalesce(f.total_orders, 0) as total_orders,
    coalesce(f.confirmed_orders, 0) as confirmed_orders,
    f.confirmation_rate,
    coalesce(f.revenue_confirmed, 0) as revenue_confirmed,
    coalesce(r.revenue_delivered, 0) as revenue_delivered,
    coalesce(f.cancelled_orders, 0) as cancelled_orders,
    coalesce(f.pending_orders, 0) as pending_orders,
    coalesce(f.en_attente, 0) as en_attente,
    coalesce(f.annulees, 0) as annulees,
    0 as rupture_stock,
    coalesce(f.doublons, 0) as doublons,
    coalesce(f.retournees, 0) as retournees,
    coalesce(r.livres, 0) as livres,
    round(100.0 * coalesce(r.livres, 0) / nullif(f.confirmed_orders, 0), 1) as taux_livraison
  from funnel f
  full outer join revenu_livre r on r.country = f.country;
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
