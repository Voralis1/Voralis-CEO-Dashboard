-- ShipLead leads integration schema (source /orders/search) — complète shiplead_schema.sql
-- (shippings). Run this once in Supabase → SQL Editor, avant shiplead_schema.sql.
-- Même plateforme backend que Shipsen (voir scripts/sync/shipsen_family_common.py) — schéma
-- copié de shipsen_leads_schema.sql, adapté (pas de particularité connue à ce jour, 2026-08-03).
--
-- Vocabulaire de order.status.name audité en direct (~200 commandes, 2026-08-03) :
--   Pending, Cancelled, Confirmed, Unreached, "En attente de dépot" — identique à Shipsen, pas
--   de "double" observé sur cet échantillon (contrairement à MLShipAfrica, voir son propre
--   schéma).
--
-- Entrepôts récupérés dynamiquement depuis content.warehouses à chaque login (pas de liste
-- figée comme WAREHOUSES dans sync_shipsen.py) — voir sync_shiplead.py.

create table if not exists shiplead_leads (
  mongo_id text primary key,                -- _id de l'ORDER (pas du shipping) — unique globalement
  order_id text not null,                   -- order.id, l'id lisible ShipLead
  country text not null,
  currency text not null,
  warehouse_id text not null,
  customer_name text,
  customer_phone text,
  product_name text,                        -- order.details[0].productName
  quantity integer,
  unit_price numeric,
  total_price numeric not null default 0,   -- order.totalPrice
  status_name text not null,                -- Pending/Cancelled/Unreached/En attente de dépot/Confirmed
  order_date timestamptz not null,          -- order.date
  created_at timestamptz,
  updated_at timestamptz,
  unreached_count integer,
  last_unreached_date timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists shiplead_leads_warehouse_idx on shiplead_leads (warehouse_id);
create index if not exists shiplead_leads_country_idx on shiplead_leads (country);
create index if not exists shiplead_leads_order_date_idx on shiplead_leads (order_date);
create index if not exists shiplead_leads_warehouse_order_idx on shiplead_leads (warehouse_id, order_id);

alter table shiplead_leads enable row level security;

drop policy if exists "Allow read for authenticated users" on shiplead_leads;
create policy "Allow read for authenticated users"
  on shiplead_leads for select
  to authenticated
  using (true);
