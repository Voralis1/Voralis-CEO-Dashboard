-- MLShipAfrica integration schema (shippings — table mlshipafrica_orders).
-- Run this once in Supabase → SQL Editor, APRÈS mlshipafrica_leads_schema.sql.
-- Source : https://api.mlshipafrica.app/api/shippings/search.
-- Même plateforme backend que Shipsen (voir scripts/sync/shipsen_family_common.py) — schéma et
-- fonction KPI basés sur shipsen_schema.sql, avec 2 différences réelles (auditées le 2026-08-03) :
--   - doublons réellement peuplé (status_name='double' côté leads, contrairement à
--     Shipsen/ShipLead où ce statut n'a jamais été observé).
--   - "return" (pas "refunded") est le statut de retour observé côté shippings — vocabulaire
--     mixte AfricaCOD-like malgré l'enveloppe API façon Shipsen. "processed"/"to prepare"
--     également observés ; queued/paid/shipped pas encore vus sur l'échantillon mais gardés dans
--     le mapping par cohérence (même backend que Shipsen/ShipLead).
--   - pas de colonne warehouse_id (voir mlshipafrica_leads_schema.sql pour le détail).

create table if not exists mlshipafrica_orders (
  mongo_id text primary key,
  order_id text not null,
  country text not null,
  currency text not null,
  customer_name text,
  customer_phone text,
  product_name text,
  quantity integer,
  unit_price numeric,
  total_price numeric not null default 0,
  status text not null,                     -- queued/received/reprogrammed/to prepare/paid/processed/shipped/cancelled/return
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

create index if not exists mlshipafrica_orders_country_idx on mlshipafrica_orders (country);
create index if not exists mlshipafrica_orders_order_date_idx on mlshipafrica_orders (order_date);

alter table mlshipafrica_orders enable row level security;

drop policy if exists "Allow read for authenticated users" on mlshipafrica_orders;
create policy "Allow read for authenticated users"
  on mlshipafrica_orders for select
  to authenticated
  using (true);

-- KPI par marché filtré par période — basé sur kpi_shipsen_marche_periode, avec doublons
-- réellement calculé (status_name='double') et retournees sur status='return' (pas 'refunded').
--
-- ⚠️ total_orders CORRIGÉ (2026-08-05) : copié initialement de Shipsen (confirmed_orders +
-- cancelled_orders, PAS un count(*) de tous les leads créés — voir shipsen_schema.sql ligne 237,
-- décision CEO du 2026-07-31 pour matcher EXACTEMENT le widget natif Shipsen "Total Orders", qui
-- exclut lui-même les commandes en attente). Cette hypothèse ne tenait PAS pour MLShipAfrica :
-- vérifié en direct le 2026-08-05 (rescan complet + comparaison au widget natif MLShipAfrica,
-- filtre 01/07-31/07/2026) — le widget natif "TOTAL ORDERS" affichait 340, notre ancien calcul
-- (confirmées+annulées) donnait 209, alors qu'un vrai count(*) de tous les leads créés (order_date
-- dans la fenêtre, tout statut confondu, y compris en attente/injoignables) donne 372 — bien plus
-- proche du widget natif que 209 (écart résiduel probable du même type que celui documenté pour
-- ClickMarket : le préréglage natif n'est pas forcément calé sur un mois calendaire strict).
-- total_orders repasse donc sur le même modèle que ClickMarket/Coliscod/Africod Congo : count(*)
-- de tous les leads créés sur la période, en attente incluse — confirmation_rate et
-- taux_livraison utilisent désormais ce total_orders (order_date) comme dénominateur, plus
-- confirmed_orders+cancelled_orders. Ne PAS reporter cette correction sur Shipsen : pour Shipsen
-- spécifiquement, confirmed+cancelled reste le bon calcul (vérifié, demandé par le CEO).
drop function if exists kpi_mlshipafrica_marche_periode(date, date);
create or replace function kpi_mlshipafrica_marche_periode(date_from date, date_to date)
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
      count(*) as total_orders,
      count(*) filter (where status_name = 'double') as doublons,
      count(*) filter (where status_name not in ('Confirmed', 'Cancelled', 'double')) as pending_orders,
      round(
        avg(
          extract(epoch from (coalesce(last_unreached_date, updated_at) - order_date)) / 3600.0
        ) filter (
          where unreached_count <= 1
            and (last_unreached_date is not null or updated_at is not null)
        ),
        1
      ) as delai_1er_contact_heures
    from mlshipafrica_leads
    where order_date::date between date_from and date_to
    group by country
  ),
  confirmation as (
    select
      country,
      count(*) filter (where status_name = 'Confirmed') as confirmed_orders,
      count(*) filter (where status_name = 'Cancelled') as cancelled_orders,
      coalesce(sum(total_price) filter (where status_name = 'Confirmed'), 0) as revenue_confirmed
    from mlshipafrica_leads
    where status_name in ('Confirmed', 'Cancelled')
      and updated_at::date between date_from and date_to
    group by country
  ),
  shipping_extra as (
    select
      country,
      count(*) filter (where status = 'return') as retournees
    from mlshipafrica_orders
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
    from mlshipafrica_orders
    where status in ('processed', 'delivered', 'paid')
      and shipping_date is not null
      and shipping_date::date between date_from and date_to
    group by country
  )
  select
    coalesce(l.country, c.country, x.country, r.country) as country,
    coalesce(l.currency, r.currency) as currency,
    coalesce(l.total_orders, 0) as total_orders,
    coalesce(c.confirmed_orders, 0) as confirmed_orders,
    round(
      100.0 * coalesce(c.confirmed_orders, 0) / nullif(coalesce(l.total_orders, 0), 0),
      1
    ) as confirmation_rate,
    coalesce(c.revenue_confirmed, 0) as revenue_confirmed,
    coalesce(r.revenue_delivered, 0) as revenue_delivered,
    coalesce(c.cancelled_orders, 0) as cancelled_orders,
    coalesce(l.pending_orders, 0) as pending_orders,
    coalesce(l.pending_orders, 0) as en_attente,
    coalesce(c.cancelled_orders, 0) as annulees,
    0 as rupture_stock,
    coalesce(l.doublons, 0) as doublons,
    coalesce(x.retournees, 0) as retournees,
    coalesce(r.livres, 0) as livres,
    round(
      100.0 * coalesce(r.livres, 0) / nullif(coalesce(l.total_orders, 0), 0),
      1
    ) as taux_livraison,
    l.delai_1er_contact_heures
  from leads l
  full outer join confirmation c on c.country = l.country
  full outer join shipping_extra x on x.country = coalesce(l.country, c.country)
  full outer join revenu_livre r on r.country = coalesce(l.country, c.country, x.country);
$$;

grant execute on function kpi_mlshipafrica_marche_periode(date, date) to authenticated;
