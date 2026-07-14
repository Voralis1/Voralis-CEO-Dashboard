-- Shipsen integration schema (shippings — table shipsen_orders).
-- Run this once in Supabase → SQL Editor, puis exécuter aussi shipsen_leads_schema.sql (table
-- shipsen_leads, source /orders/search) : les deux tables sont complémentaires depuis 2026-07-14
-- (voir shipsen_leads_schema.sql pour le détail — /orders/search et /shippings/search sont deux
-- collections MongoDB distinctes, pas une simple vue différente des mêmes données).
-- Source de cette table : https://api.shipsen.com/shippings/search (page "Shipping Orders").

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
--   - processed/delivered/paid : comptés comme "livré + encaissé" (2026-07-14). ca_livre/
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

-- ⚠️ order_id n'est PAS unique par warehouse (2026-07-14) : une commande peut être réexpédiée
-- après un échec de livraison (statut "reprogrammed"), ce qui crée un DEUXIÈME enregistrement de
-- shipping (mongo_id différent) pour le même order_id. La contrainte unique posée ici à l'origine
-- reposait sur une hypothèse fausse et a fait échouer ~70% des upserts en production (409 sur
-- l'upsert Supabase dès qu'une commande a un 2e shipping — mongo_id est déjà la vraie clé
-- primaire, résolue par ON CONFLICT ; ce 2e index bloquait des lignes légitimes et différentes).
-- Remplacé par un index simple (recherche par warehouse+order_id), sans contrainte d'unicité.
drop index if exists shipsen_orders_warehouse_order_idx;
create index if not exists shipsen_orders_warehouse_order_idx
  on shipsen_orders (warehouse_id, order_id);

alter table shipsen_orders enable row level security;

drop policy if exists "Allow read for authenticated users" on shipsen_orders;
create policy "Allow read for authenticated users"
  on shipsen_orders for select
  to authenticated
  using (true);

-- ⚠️ REFONTE (2026-07-14) : total_orders/confirmed_orders/cancelled_orders/pending_orders
-- viennent désormais de shipsen_leads (/orders/search — voir shipsen_leads_schema.sql), PAS de
-- shipsen_orders (/shippings/search). Constat en direct sur l'API : ce sont deux collections
-- MongoDB différentes avec des volumes très différents (ex. Mali : 6041 orders vs 1331
-- shippings — /shippings/search n'expose que les commandes ayant déjà atteint le stade
-- d'expédition, donc déjà confirmées). Avant cette refonte, "Total commande" mesurait en
-- réalité "total shippings" (sous-ensemble) et "confirmed_orders" était un proxy artificiel
-- (total_shippings - cancelled - refunded), pas un vrai comptage de confirmation — ce qui
-- rendait ces colonnes structurellement incomparables à ClickMarket/Coliscod/Africod Congo (CEO,
-- 2026-07-14 : "les données de shipsen et [celles] de clickmarket ne sont pas compatibles").
-- livres/revenue_delivered restent sur shipsen_orders (shippings) : c'est le seul endpoint qui
-- porte le statut de LIVRAISON physique (processed/paid) et les dates paid_at/processed_at.
-- retournees reste aussi sur shipsen_orders (status='refunded') : ce concept n'existe pas côté
-- leads (order.status ne connaît que Pending/Cancelled/Unreached/En attente de dépot/Confirmed/
-- Expired, vocabulaire audité en direct — pas de "Double" ni de "refunded" observés).
create or replace view shipsen_kpi_by_country
  with (security_invoker = true) as
select
  l.country,
  l.currency,
  l.total_orders,
  l.confirmed_orders,
  round(100.0 * l.confirmed_orders / nullif(l.total_orders, 0), 1) as confirmation_rate,
  l.revenue_confirmed,
  coalesce(r.revenue_delivered, 0) as revenue_delivered,
  l.cancelled_orders,
  l.pending_orders
from (
  select
    country,
    max(currency) as currency,
    count(*) as total_orders,
    count(*) filter (where status_name = 'Confirmed') as confirmed_orders,
    count(*) filter (where status_name = 'Cancelled') as cancelled_orders,
    count(*) filter (where status_name not in ('Confirmed', 'Cancelled')) as pending_orders,
    coalesce(sum(total_price) filter (where status_name = 'Confirmed'), 0) as revenue_confirmed
  from shipsen_leads
  group by country
) l
left join (
  select
    country,
    coalesce(sum(total_price) filter (where status in ('processed', 'delivered', 'paid')), 0)
      - 11 * count(*) filter (where status in ('processed', 'delivered', 'paid')) as revenue_delivered
  from shipsen_orders
  group by country
) r on r.country = l.country;

-- KPI global, tous pays confondus. Uniquement des COMPTES de commandes :
-- pas de revenu global, puisque les devises (XOF / GNF) ne sont pas additionnables.
create or replace view shipsen_kpi_global
  with (security_invoker = true) as
select
  count(*) filter (where status_name = 'Confirmed') as total_confirmed_orders,
  count(*) as total_orders_all,
  round(
    100.0 * count(*) filter (where status_name = 'Confirmed') / nullif(count(*), 0),
    1
  ) as global_confirmation_rate
from shipsen_leads;

grant select on shipsen_kpi_by_country to authenticated;
grant select on shipsen_kpi_global to authenticated;

-- Variantes filtrées par période, pour respecter le sélecteur de dates du dashboard (De / À).
-- leads (total_orders/confirmed_orders/confirmation_rate/cancelled/pending/en_attente/annulees)
-- vient de shipsen_leads, filtré sur order_date (order.date — pas order.createdAt, voir note de
-- shipsen_leads_schema.sql). revenu_livre (livres/revenue_delivered) reste sur shipsen_orders,
-- filtré sur la date de CLÔTURE (coalesce(processed_at, paid_at)), conformément à la règle
-- "l'argent n'existe que sur commande livrée et encaissée" — même logique que ClickMarket/
-- Coliscod/Africod Congo (FULL OUTER JOIN pour ne pas perdre un pays qui n'a clôturé que des
-- commandes créées hors fenêtre). taux_livraison = livres / total_orders (univers leads complet,
-- plus le sous-ensemble shippings — corrige le taux qui pouvait dépasser 100% avant la refonte).
-- Utilisation : select * from kpi_shipsen_marche_periode('2026-06-01', '2026-06-30');
--   - doublons/rupture_stock : aucun statut équivalent observé côté leads — colonnes à 0.
--   - annulees        : status_name = 'Cancelled' (leads, pas shippings).
--   - en_attente      : ni confirmé ni annulé côté leads — inclut Pending, Unreached,
--                       "En attente de dépot", Expired.
--   - retournees      : status = 'refunded' côté shippings (voir note ci-dessus, aucun
--                       équivalent côté leads).
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
  with leads as (
    select
      country,
      max(currency) as currency,
      count(*) as total_orders,
      count(*) filter (where status_name = 'Confirmed') as confirmed_orders,
      count(*) filter (where status_name = 'Cancelled') as cancelled_orders,
      count(*) filter (where status_name not in ('Confirmed', 'Cancelled')) as pending_orders,
      coalesce(sum(total_price) filter (where status_name = 'Confirmed'), 0) as revenue_confirmed
    from shipsen_leads
    where order_date::date between date_from and date_to
    group by country
  ),
  shipping_extra as (
    select
      country,
      count(*) filter (where status = 'refunded') as retournees
    from shipsen_orders
    where order_date::date between date_from and date_to
    group by country
  ),
  revenu_livre as (
    select
      country,
      max(currency) as currency,
      count(*) as livres,
      coalesce(sum(total_price), 0) - 11 * count(*) as revenue_delivered
    from shipsen_orders
    where status in ('processed', 'delivered', 'paid')
      and coalesce(processed_at, paid_at) is not null
      and coalesce(processed_at, paid_at)::date between date_from and date_to
    group by country
  )
  select
    coalesce(l.country, x.country, r.country) as country,
    coalesce(l.currency, r.currency) as currency,
    coalesce(l.total_orders, 0) as total_orders,
    coalesce(l.confirmed_orders, 0) as confirmed_orders,
    round(100.0 * coalesce(l.confirmed_orders, 0) / nullif(l.total_orders, 0), 1) as confirmation_rate,
    coalesce(l.revenue_confirmed, 0) as revenue_confirmed,
    coalesce(r.revenue_delivered, 0) as revenue_delivered,
    coalesce(l.cancelled_orders, 0) as cancelled_orders,
    coalesce(l.pending_orders, 0) as pending_orders,
    coalesce(l.pending_orders, 0) as en_attente,
    coalesce(l.cancelled_orders, 0) as annulees,
    0 as rupture_stock,
    0 as doublons,
    coalesce(x.retournees, 0) as retournees,
    coalesce(r.livres, 0) as livres,
    round(100.0 * coalesce(r.livres, 0) / nullif(l.total_orders, 0), 1) as taux_livraison
  from leads l
  full outer join shipping_extra x on x.country = l.country
  full outer join revenu_livre r on r.country = coalesce(l.country, x.country);
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
    count(*) filter (where status_name = 'Confirmed') as total_confirmed_orders,
    count(*) as total_orders_all,
    round(
      100.0 * count(*) filter (where status_name = 'Confirmed') / nullif(count(*), 0),
      1
    ) as global_confirmation_rate
  from shipsen_leads
  where order_date::date between date_from and date_to;
$$;

grant execute on function kpi_shipsen_marche_periode(date, date) to authenticated;
grant execute on function kpi_shipsen_global_periode(date, date) to authenticated;