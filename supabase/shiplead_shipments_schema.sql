-- ShipLead expeditions (stock entrant fournisseur → warehouse) integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.myshiplead.com/expeditions/search
-- Même plateforme backend que Shipsen (voir shipsen_expeditions_schema.sql) : une expédition a
-- `details[]` (un item par produit, quantity.{sent,received,defective}), et le pays destination
-- vient de warehouse.countryName (déjà le nom complet, ex. "Cameroon") — vérifié en direct
-- 2026-08-05, pas besoin de filtrer par warehouse : /expeditions/search renvoie tous les marchés
-- du compte en un seul flux paginé.

create table if not exists shiplead_shipments (
  detail_id text primary key,               -- details[]._id — unique par item, pas par expédition
  expedition_id text not null,              -- expedition._id
  country text not null,                    -- warehouse.countryName (déjà le nom complet)
  product_name text not null,               -- details[].product.name
  shipment_date date,                       -- expedition.date
  arrival_date timestamptz,                 -- expedition.arrivalDate
  source_country text,                      -- expedition.country (origine)
  quantity_sent integer,
  quantity_arrived integer,
  quantity_defected integer,
  status text,                              -- expedition.status (ex. "received")
  synced_at timestamptz not null default now()
);

create index if not exists shiplead_shipments_country_idx on shiplead_shipments (country);
create index if not exists shiplead_shipments_shipment_date_idx on shiplead_shipments (shipment_date);

alter table shiplead_shipments enable row level security;

drop policy if exists "Allow read for authenticated users" on shiplead_shipments;
create policy "Allow read for authenticated users"
  on shiplead_shipments for select
  to authenticated
  using (true);
