-- Shipsen leads (orders) integration schema — complète shipsen_schema.sql (shippings).
-- Run this once in Supabase → SQL Editor, après shipsen_schema.sql.
-- Source: https://api.shipsen.com/orders/search (page "Orders" — univers complet des commandes,
-- confirmées ou non — DISTINCT de /shippings/search qui n'expose que les commandes ayant déjà
-- atteint le stade d'expédition, donc déjà confirmées).
--
-- Pourquoi cette table (2026-07-14) : le CEO a signalé que "Total commande"/"Commandes
-- confirmées" sur le dashboard ne correspondaient pas à ClickMarket. Vérifié en direct sur
-- l'API : /orders/search et /shippings/search sont deux collections MongoDB différentes avec des
-- volumes très différents (ex. Mali : 6041 orders vs 1331 shippings) — contrairement à
-- ClickMarket/Coliscod/Africod Congo où "leads" est un sur-ensemble de "orders" dans le MÊME
-- endpoint, Shipsen a deux endpoints réellement distincts. Jusqu'ici on ne synchronisait que
-- /shippings/search, donc "Total commande" mesurait en réalité "total shippings" (sous-ensemble
-- post-confirmation) et "Commandes confirmées" était un proxy artificiel (total - annulées -
-- retournées calculé sur ce même sous-ensemble), pas un vrai comptage de confirmation.
--
-- Vocabulaire de order.status.name audité sur ~1000 commandes réelles (Mali + Guinea) :
--   Pending, Cancelled, Unreached, "En attente de dépot", Confirmed, Expired.
--   (Pas de "Double" observé sur cet échantillon — colonne doublons gardée à 0 comme les autres
--   réseaux tant qu'aucune occurrence n'est vue.)
--
-- Date de référence : order.date (PAS order.createdAt, qui s'est avéré identique sur plusieurs
-- commandes différentes dans le même échantillon — probablement un timestamp d'import en lot,
-- pas la date réelle de la commande individuelle). shipsen-sync.workflow.json (shippings) a été
-- corrigé pour utiliser la même colonne order.date au lieu de order.createdAt, par cohérence.

create table if not exists shipsen_leads (
  mongo_id text primary key,                -- _id de l'ORDER (pas du shipping) — unique globalement
  order_id text not null,                   -- order.id, l'id lisible Shipsen
  country text not null,
  currency text not null,
  warehouse_id text not null,
  customer_name text,
  customer_phone text,
  product_name text,                        -- order.details[0].productName
  quantity integer,
  unit_price numeric,
  total_price numeric not null default 0,   -- order.totalPrice
  status_name text not null,                -- Pending/Cancelled/Unreached/En attente de dépot/Confirmed/Expired
  order_date timestamptz not null,          -- order.date (pas createdAt — voir note ci-dessus)
  created_at timestamptz,
  updated_at timestamptz,
  -- Délai 1er contact (2026-07-14) : équivalent Shipsen de no_answer_count/last_unreached_date
  -- (ClickMarket/Coliscod/Africod Congo) — order.unreachedBySize (compteur) et
  -- order.lastUnreachedDate (date de la DERNIÈRE tentative ratée, pas la première). Pas de
  -- confirmed_at côté Shipsen leads : order.updatedAt sert de repli pour le cas
  -- unreached_count = 0 (résolution au 1er appel), moins précis mais seul signal disponible.
  unreached_count integer,
  last_unreached_date timestamptz,
  synced_at timestamptz not null default now()
);

alter table shipsen_leads add column if not exists unreached_count integer;
alter table shipsen_leads add column if not exists last_unreached_date timestamptz;

create index if not exists shipsen_leads_warehouse_idx on shipsen_leads (warehouse_id);
create index if not exists shipsen_leads_country_idx on shipsen_leads (country);
create index if not exists shipsen_leads_order_date_idx on shipsen_leads (order_date);
-- Pas de contrainte unique sur (warehouse_id, order_id) : même précaution que shipsen_orders
-- (voir sa note du 2026-07-14) — on ne suppose plus l'unicité d'order_id sans l'avoir vérifiée.
create index if not exists shipsen_leads_warehouse_order_idx on shipsen_leads (warehouse_id, order_id);

alter table shipsen_leads enable row level security;

drop policy if exists "Allow read for authenticated users" on shipsen_leads;
create policy "Allow read for authenticated users"
  on shipsen_leads for select
  to authenticated
  using (true);

grant select on shipsen_leads to authenticated;
