-- Shipsen expeditions (stock entrant fournisseur → warehouse) integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.shipsen.com/expeditions/search
-- Structure différente de la famille ClickMarket/Coliscod/Africod Congo : une expédition a
-- `details[]` (un item par produit, quantity.{sent,received,defective}), et le pays destination
-- vient de warehouse.countryName (déjà le nom complet, ex. "Guinea" — pas besoin de mapping via
-- notre config WAREHOUSES comme pour shipsen_orders).

create table if not exists shipsen_expeditions (
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
  status text,                              -- expedition.status (ex. "processed")
  synced_at timestamptz not null default now()
);

create index if not exists shipsen_expeditions_country_idx on shipsen_expeditions (country);
create index if not exists shipsen_expeditions_shipment_date_idx on shipsen_expeditions (shipment_date);

alter table shipsen_expeditions enable row level security;

drop policy if exists "Allow read for authenticated users" on shipsen_expeditions;
create policy "Allow read for authenticated users"
  on shipsen_expeditions for select
  to authenticated
  using (true);