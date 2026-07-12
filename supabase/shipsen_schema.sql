-- Shipsen integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.shipsen.com/shippings/search (page "Shipping Orders" — PAS /orders/search,
-- qui alimentait la version précédente de ce schéma).

-- ⚠️ MIGRATION depuis l'ancienne version (basée sur /orders/search) : le vocabulaire de
-- `status` change complètement. Avant : Pending/Confirmed/Cancelled/Double/Expired (statut de
-- CONFIRMATION de la commande). Maintenant : queued/received/reprogrammed/prepared/paid/
-- processed/shipped/cancelled/refunded, tous en minuscules (statut du SHIPPING, c'est-à-dire
-- l'avancement de la livraison physique — la confirmation a déjà eu lieu avant qu'une commande
-- n'apparaisse dans /shippings/search). Les anciennes lignes ne sont pas compatibles avec les
-- vues ci-dessous — repartir propre avant de ré-exécuter ce script :
--   drop table if exists shipsen_orders cascade;
-- puis relancer une synchro n8n complète (voir n8n/shipsen-sync.workflow.json).
--
-- Mapping validé sur données réelles (audit des valeurs distinctes de `status` sur les 4
-- warehouses, ~2500 lignes échantillonnées) :
--   - processed       : seul statut compté comme "livré + encaissé" (2026-07 — décision produit :
--                       `paid` est exclu bien que paidAt y soit aussi renseigné, pour ne compter
--                       que les commandes définitivement clôturées côté entrepôt). ca_livre/
--                       revenue_delivered déduisent 11$ de frais de livraison fixe par commande
--                       (même frais que les 3 autres réseaux, cf. field cash Angola).
--   - cancelled       : annulée, jamais encaissée.
--   - refunded        : retournée. La colonne booléenne is_refunded existe dans l'API mais reste
--                       à false même sur ces lignes (déjà signalé comme non fiable sur l'ancien
--                       schéma) — on utilise `status = 'refunded'` à la place, qui lui est réel.
--                       Équivalent du statut "return" des 3 autres réseaux — Shipsen n'a pas de
--                       valeur "return" littérale, "refunded" est la plus proche/seule pertinente.
--   - queued/received/reprogrammed/prepared/paid/shipped : étapes intermédiaires, ni livrées ni
--                       rejetées → "en attente" (paid y compris désormais).
--   - doublons/rupture_stock : aucun statut équivalent observé dans ce vocabulaire → colonnes
--                       gardées à 0 pour cohérence structurelle avec les 3 autres réseaux.
--   - confirmed_orders : ce champ n'a plus le même sens qu'avant (il n'existe pas de statut
--                       "en attente de confirmation" dans /shippings/search — une commande n'y
--                       apparaît que si elle a déjà été confirmée en amont). Redéfini comme
--                       "toujours valide dans le pipeline" = total - annulées - retournées, donc
--                       structurellement élevé (proche de 100%) par construction. C'est attendu,
--                       pas un bug : le taux de confirmation "réel" (leads → confirmés) se mesure
--                       en amont, pas sur ce flux.

create table if not exists shipsen_orders (
  mongo_id text primary key,                -- _id du SHIPPING (pas de l'order) — unique globalement
  order_id text not null,                   -- order.id, l'id lisible Shipsen (unique par warehouse)
  country text not null,
  currency text not null,
  warehouse_id text not null,
  customer_name text,
  customer_phone text,
  product_name text,                        -- order.details[0].productName
  quantity integer,
  unit_price numeric,
  total_price numeric not null default 0,   -- order.totalPrice
  status text not null,                     -- statut du SHIPPING : queued/received/reprogrammed/
                                             -- prepared/paid/processed/shipped/cancelled/refunded
  is_processed boolean not null default false,
  is_refunded boolean not null default false, -- non fiable (voir note ci-dessus) — utiliser `status`
  source text,
  tracking_number text,
  shipping_date date,                       -- date de livraison planifiée (shipping.date)
  order_date timestamptz not null,          -- date de création de l'ORDER (order.createdAt)
  created_at timestamptz,                   -- date de création du SHIPPING
  updated_at timestamptz,
  paid_at timestamptz,                      -- encaissement effectif (COD payé)
  processed_at timestamptz,                 -- clôture définitive côté entrepôt (après paid)
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

drop policy if exists "Allow read for authenticated users" on shipsen_orders;
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
  count(*) filter (where status not in ('cancelled', 'refunded')) as confirmed_orders,
  round(
    100.0 * count(*) filter (where status not in ('cancelled', 'refunded')) / nullif(count(*), 0),
    1
  ) as confirmation_rate,
  coalesce(sum(total_price) filter (where status not in ('cancelled', 'refunded')), 0) as revenue_confirmed,
  coalesce(sum(total_price) filter (where status = 'processed'), 0)
    - 11 * count(*) filter (where status = 'processed') as revenue_delivered,
  count(*) filter (where status = 'cancelled') as cancelled_orders,
  count(*) filter (where status not in ('cancelled', 'refunded', 'processed')) as pending_orders
from shipsen_orders
group by country;

-- KPI global, tous pays confondus. Uniquement des COMPTES de commandes :
-- pas de revenu global, puisque les devises (XOF / GNF) ne sont pas additionnables.
create or replace view shipsen_kpi_global
  with (security_invoker = true) as
select
  count(*) filter (where status not in ('cancelled', 'refunded')) as total_confirmed_orders,
  count(*) as total_orders_all,
  round(
    100.0 * count(*) filter (where status not in ('cancelled', 'refunded')) / nullif(count(*), 0),
    1
  ) as global_confirmation_rate
from shipsen_orders;

grant select on shipsen_kpi_by_country to authenticated;
grant select on shipsen_kpi_global to authenticated;

-- Variantes filtrées par période, pour respecter le sélecteur de dates du dashboard (De / À).
-- Le funnel (total_orders/confirmed_orders/confirmation_rate/cancelled/pending/livres) reste basé
-- sur la date de CRÉATION de l'order (order_date). Seul revenue_delivered bascule sur la date de
-- CLÔTURE (processed_at), conformément à la règle "l'argent n'existe que sur commande livrée et
-- encaissée" — même logique que ClickMarket/Coliscod/Africod Congo (FULL OUTER JOIN pour ne pas
-- perdre un pays qui n'a clôturé que des commandes créées hors fenêtre).
-- Utilisation : select * from kpi_shipsen_marche_periode('2026-06-01', '2026-06-30');
-- Extension : en_attente/annulees/rupture_stock/doublons/retournees, ajoutés pour le tableau
-- prestataire partagé (colonnes strictement identiques sur les 4 réseaux) :
--   - doublons/rupture_stock : aucun statut équivalent observé — colonnes à 0.
--   - annulees        : status = 'cancelled'.
--   - retournees      : status = 'refunded' (voir note migration — plus fiable que l'ancienne
--                       colonne is_refunded, qui restait à false même sur ces lignes).
--   - en_attente      : ni livré (processed), ni annulé, ni retourné — inclut queued, received,
--                       reprogrammed, prepared, paid, shipped.
--   - livres/taux_livraison : status = 'processed' uniquement (paid exclu, 2026-07) — voir note
--                       migration ci-dessus. taux_livraison = livres/total_orders (plus de
--                       confirmed_orders au dénominateur, ce champ n'est plus affiché dans le
--                       tableau Réseaux Logistiques/COD).
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
      count(*) filter (where status not in ('cancelled', 'refunded')) as confirmed_orders,
      round(
        100.0 * count(*) filter (where status not in ('cancelled', 'refunded')) / nullif(count(*), 0),
        1
      ) as confirmation_rate,
      coalesce(sum(total_price) filter (where status not in ('cancelled', 'refunded')), 0) as revenue_confirmed,
      count(*) filter (where status = 'cancelled') as cancelled_orders,
      count(*) filter (where status not in ('cancelled', 'refunded', 'processed')) as pending_orders,
      count(*) filter (where status = 'processed') as livres,
      0 as doublons,
      count(*) filter (where status = 'cancelled') as annulees,
      count(*) filter (where status = 'refunded') as retournees,
      count(*) filter (where status not in ('cancelled', 'refunded', 'processed')) as en_attente
    from shipsen_orders
    where order_date::date between date_from and date_to
    group by country
  ),
  revenu_livre as (
    select
      country,
      max(currency) as currency,
      coalesce(sum(total_price), 0) - 11 * count(*) as revenue_delivered
    from shipsen_orders
    where status = 'processed'
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
    coalesce(f.livres, 0) as livres,
    round(100.0 * coalesce(f.livres, 0) / nullif(f.total_orders, 0), 1) as taux_livraison
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
    count(*) filter (where status not in ('cancelled', 'refunded')) as total_confirmed_orders,
    count(*) as total_orders_all,
    round(
      100.0 * count(*) filter (where status not in ('cancelled', 'refunded')) / nullif(count(*), 0),
      1
    ) as global_confirmation_rate
  from shipsen_orders
  where order_date::date between date_from and date_to;
$$;

grant execute on function kpi_shipsen_marche_periode(date, date) to authenticated;
grant execute on function kpi_shipsen_global_periode(date, date) to authenticated;