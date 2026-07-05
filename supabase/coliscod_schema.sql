-- Coliscod (AfricaCOD) integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.africacod.com/api/orders-paginated

create table if not exists coliscod_leads (
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

create index if not exists coliscod_leads_country_idx on coliscod_leads (country_id);
create index if not exists coliscod_leads_order_date_idx on coliscod_leads (order_date);

alter table coliscod_leads enable row level security;

create policy "Allow read for authenticated users"
  on coliscod_leads for select
  to authenticated
  using (true);

-- KPI par marché (pays), calcul instantané côté Postgres.
-- security_invoker = true : la vue respecte les policies RLS de coliscod_leads
-- au lieu de s'exécuter avec les droits du propriétaire de la vue.
create or replace view kpi_coliscod_marche
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
from coliscod_leads
group by country_id;

-- Variante filtrée par période, pour respecter le sélecteur de dates du dashboard (De / À).
-- Le funnel (leads/confirmées/taux) reste basé sur la date de CRÉATION (order_date) — c'est un
-- indicateur d'entonnoir, pas un montant. Seul ca_livre bascule sur la date de LIVRAISON
-- (delivered_at), conformément à la règle "l'argent n'existe que sur commande livrée et
-- encaissée" : une commande livrée pendant la période compte dans ca_livre même si elle a été
-- créée avant la fenêtre sélectionnée (et une commande créée dans la fenêtre mais pas encore
-- livrée n'y contribue pas).
-- FULL OUTER JOIN entre les deux sous-requêtes : un pays qui n'a livré/encaissé que des
-- commandes créées hors fenêtre doit quand même apparaître avec son ca_livre correct (sinon
-- cet argent disparaîtrait silencieusement du rapport).
-- Utilisation : select * from kpi_coliscod_marche_periode('2026-06-01', '2026-06-30');
-- Extension : en_attente/annulees/rupture_stock/doublons, ajoutés pour le tableau prestataire
-- partagé (colonnes strictement identiques sur les 4 réseaux). Mapping validé sur données
-- réelles (audit des valeurs distinctes de confirmation_status/shipping_status) :
--   - doublons        : confirmation_status = 'double' (exclu du calcul des taux, affiché à part)
--   - rupture_stock   : Coliscod n'a pas de statut "out_of_stock" — colonne gardée à 0 pour
--                       cohérence structurelle avec les autres réseaux (colonnes identiques)
--   - annulees        : cancelled sur confirmation_status OU shipping_status (OR sur une seule
--                       ligne, jamais une addition des deux — pas de double comptage possible)
--   - en_attente      : tout lead ni livré, ni annulé, ni doublon — inclut "pending", "remind",
--                       "unreached" et "confirmé mais pas encore livré"
create or replace function kpi_coliscod_marche_periode(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  total_leads bigint,
  confirmes bigint,
  taux_confirmation numeric,
  livres bigint,
  taux_livraison numeric,
  ca_livre numeric,
  en_attente bigint,
  annulees bigint,
  rupture_stock bigint,
  doublons bigint
)
language sql
security invoker
stable
as $$
  with funnel as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) as total_leads,
      count(*) filter (where confirmation_status = 'confirmed') as confirmes,
      count(*) filter (where delivered_at is not null) as livres,
      count(*) filter (where confirmation_status = 'double') as doublons,
      count(*) filter (where confirmation_status = 'cancelled' or shipping_status = 'cancelled') as annulees,
      count(*) filter (
        where delivered_at is null
          and confirmation_status is distinct from 'cancelled'
          and shipping_status is distinct from 'cancelled'
          and confirmation_status is distinct from 'double'
      ) as en_attente
    from coliscod_leads
    where order_date between date_from and date_to
    group by country_id
  ),
  revenu_livre as (
    select
      country_id,
      max(country_name) as country_name,
      coalesce(sum(total_price), 0) as ca_livre
    from coliscod_leads
    where delivered_at is not null
      and delivered_at::date between date_from and date_to
    group by country_id
  )
  select
    coalesce(f.country_id, r.country_id) as country_id,
    coalesce(f.country_name, r.country_name) as country_name,
    coalesce(f.total_leads, 0) as total_leads,
    coalesce(f.confirmes, 0) as confirmes,
    round(100.0 * coalesce(f.confirmes, 0) / nullif(f.total_leads, 0), 1) as taux_confirmation,
    coalesce(f.livres, 0) as livres,
    round(100.0 * coalesce(f.livres, 0) / nullif(f.confirmes, 0), 1) as taux_livraison,
    coalesce(r.ca_livre, 0) as ca_livre,
    coalesce(f.en_attente, 0) as en_attente,
    coalesce(f.annulees, 0) as annulees,
    0 as rupture_stock,
    coalesce(f.doublons, 0) as doublons
  from funnel f
  full outer join revenu_livre r on r.country_id = f.country_id;
$$;

grant select on kpi_coliscod_marche to authenticated;
grant execute on function kpi_coliscod_marche_periode(date, date) to authenticated;
