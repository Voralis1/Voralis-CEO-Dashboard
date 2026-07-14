-- Africod Congo (AfriqueCOD, marché Congo) integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.afriquecod.com/api/orders-paginated (X-Selected-Country: {"id":17,"name":"Congo","currency":"XAF",...})
-- orders_type=leads (page "Orders", revert 2026-07-14 — voir clickmarket_schema.sql pour le
-- détail : "leads" contient déjà les bonnes données de livraison, pas besoin de "Shipping
-- Orders" en plus). annulees = confirmation_status='cancelled' (pas shipping_status).

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
  -- Délai 1er contact (2026-07-14) : voir kpi_africod_congo_marche_periode pour le calcul et son
  -- biais documenté (fiable seulement pour no_answer_count <= 1 — même limite que ClickMarket).
  no_answer_count integer,
  last_unreached_date timestamptz,
  synced_at timestamptz not null default now()
);

alter table africod_congo_leads add column if not exists no_answer_count integer;
alter table africod_congo_leads add column if not exists last_unreached_date timestamptz;

create index if not exists africod_congo_leads_country_idx on africod_congo_leads (country_id);
create index if not exists africod_congo_leads_order_date_idx on africod_congo_leads (order_date);

alter table africod_congo_leads enable row level security;

drop policy if exists "Allow read for authenticated users" on africod_congo_leads;
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
-- Le funnel (leads/confirmées/taux) reste basé sur la date de CRÉATION (order_date) — c'est un
-- indicateur d'entonnoir, pas un montant. Seul ca_livre bascule sur la date de LIVRAISON
-- (delivered_at), conformément à la règle "l'argent n'existe que sur commande livrée et
-- encaissée" : une commande livrée pendant la période compte dans ca_livre même si elle a été
-- créée avant la fenêtre sélectionnée (et une commande créée dans la fenêtre mais pas encore
-- livrée n'y contribue pas).
-- FULL OUTER JOIN entre les deux sous-requêtes : un pays qui n'a livré/encaissé que des
-- commandes créées hors fenêtre doit quand même apparaître avec son ca_livre correct (sinon
-- cet argent disparaîtrait silencieusement du rapport).
-- Utilisation : select * from kpi_africod_congo_marche_periode('2026-06-01', '2026-06-30');
-- Extension : en_attente/annulees/rupture_stock/doublons, ajoutés pour le tableau prestataire
-- partagé (colonnes strictement identiques sur les 4 réseaux). Mapping validé sur données
-- réelles (audit des valeurs distinctes de confirmation_status/shipping_status) :
--   - doublons        : Africod Congo n'a pas de statut "double" observé — colonne gardée pour
--                       cohérence structurelle, vaudra 0 tant que ce statut n'apparaît pas
--   - rupture_stock   : pas de statut "out_of_stock" côté Africod Congo — colonne à 0
--   - annulees        : cancelled sur confirmation_status OU shipping_status (OR sur une seule
--                       ligne, jamais une addition des deux — pas de double comptage possible)
--   - en_attente      : tout lead ni livré, ni annulé, ni doublon — inclut "pending", "remind",
--                       "unreached" et "confirmé mais pas encore livré"
--   - confirmes/taux_confirmation/en_attente/rupture_stock : conservés tels quels (funnel de
--                       confirmation) — utilisés par les alertes de la page d'accueil
--                       (lib/dashboardData.ts), pas affichés dans le tableau Réseaux
--                       Logistiques/COD depuis 2026-07.
--   - livres/taux_livraison/ca_livre/annulees/retournees : redéfinis sur shipping_status
--                       (2026-07), même mapping que ClickMarket/Coliscod (audité sur données
--                       réelles) : shipping_status='processed' = livré + encaissé, 'cancelled'
--                       = annulée, 'return' = retournée. ca_livre déduit 11$ de frais de
--                       livraison fixe par commande livrée. taux_livraison passe de
--                       livres/confirmes à livres/total_leads.
--   - delai_1er_contact_heures (2026-07-14) : moyenne de (coalesce(last_unreached_date,
--                       confirmed_at) - order_created_at) en heures, uniquement pour
--                       no_answer_count <= 1 (même limite/logique que ClickMarket — voir son
--                       schéma pour le détail complet).
--   - Décalage horaire WAT (2026-07-14) : le Congo-Brazzaville est en WAT (UTC+1). Nos colonnes
--                       timestamptz sont stockées en UTC ; caster directement `col::date` lit
--                       donc "aujourd'hui" avec 1h de retard par rapport à l'heure locale.
--                       Vérifié précisément sur Coliscod (même fuseau) : filtre UTC = 68, filtre
--                       décalé +1h = 72, widget natif = 72 (match exact). Fix appliqué aux 3
--                       dates concernées (order_created_at, confirmed_at, delivered_at) en
--                       castant `(col + interval '1 hour')::date` au lieu de `col::date`.
drop function if exists kpi_africod_congo_marche_periode(date, date);
create or replace function kpi_africod_congo_marche_periode(date_from date, date_to date)
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
  doublons bigint,
  retournees bigint,
  delai_1er_contact_heures numeric
)
language sql
security invoker
stable
as $$
  with total as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) as total_leads,
      round(
        avg(
          extract(epoch from (coalesce(last_unreached_date, confirmed_at) - order_created_at)) / 3600.0
        ) filter (
          where no_answer_count <= 1
            and (last_unreached_date is not null or confirmed_at is not null)
        ),
        1
      ) as delai_1er_contact_heures
    from africod_congo_leads
    where order_created_at is not null
      and (order_created_at + interval '1 hour')::date between date_from and date_to
    group by country_id
  ),
  funnel as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) filter (where confirmation_status = 'double') as doublons,
      count(*) filter (where confirmation_status = 'cancelled') as annulees,
      count(*) filter (where shipping_status = 'return') as retournees,
      count(*) filter (
        where delivered_at is null
          and confirmation_status is distinct from 'cancelled'
          and shipping_status is distinct from 'cancelled'
          and confirmation_status is distinct from 'double'
      ) as en_attente
    from africod_congo_leads
    where order_date between date_from and date_to
    group by country_id
  ),
  confirmation as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) as confirmes
    from africod_congo_leads
    where confirmed_at is not null
      and (confirmed_at + interval '1 hour')::date between date_from and date_to
    group by country_id
  ),
  revenu_livre as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) as livres,
      coalesce(sum(total_price), 0) - 11 * count(*) as ca_livre
    from africod_congo_leads
    where shipping_status in ('processed', 'delivered', 'paid')
      and delivered_at is not null
      and (delivered_at + interval '1 hour')::date between date_from and date_to
    group by country_id
  )
  select
    coalesce(t.country_id, f.country_id, c.country_id, r.country_id) as country_id,
    coalesce(t.country_name, f.country_name, c.country_name, r.country_name) as country_name,
    coalesce(t.total_leads, 0) as total_leads,
    coalesce(c.confirmes, 0) as confirmes,
    round(100.0 * coalesce(c.confirmes, 0) / nullif(t.total_leads, 0), 1) as taux_confirmation,
    coalesce(r.livres, 0) as livres,
    round(100.0 * coalesce(r.livres, 0) / nullif(t.total_leads, 0), 1) as taux_livraison,
    coalesce(r.ca_livre, 0) as ca_livre,
    coalesce(f.en_attente, 0) as en_attente,
    coalesce(f.annulees, 0) as annulees,
    0 as rupture_stock,
    coalesce(f.doublons, 0) as doublons,
    coalesce(f.retournees, 0) as retournees,
    t.delai_1er_contact_heures
  from total t
  full outer join funnel f on f.country_id = t.country_id
  full outer join confirmation c on c.country_id = coalesce(t.country_id, f.country_id)
  full outer join revenu_livre r on r.country_id = coalesce(t.country_id, f.country_id, c.country_id);
$$;

grant select on kpi_africod_congo_marche to authenticated;
grant execute on function kpi_africod_congo_marche_periode(date, date) to authenticated;
