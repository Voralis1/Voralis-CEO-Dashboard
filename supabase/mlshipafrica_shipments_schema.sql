-- MLShipAfrica expeditions (stock entrant fournisseur → warehouse) integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.mlshipafrica.app/api/expeditions/search
-- Même famille backend que Shipsen/ShipLead, MAIS pas de découpage par entrepôt (voir
-- sync_mlshipafrica.py) : chaque expédition porte directement `country` (origine, code ISO) et
-- `country_to` (destination, code ISO — ex. "BF") plutôt qu'un objet warehouse — vérifié en
-- direct 2026-08-05. `country` ci-dessous est donc le code ISO brut de destination, résolu côté
-- app via getCanonicalCountry() (comme pour mlshipafrica_leads/mlshipafrica_orders).

create table if not exists mlshipafrica_shipments (
  detail_id text primary key,               -- details[]._id — unique par item, pas par expédition
  expedition_id text not null,              -- expedition._id
  country text not null,                    -- expedition.country_to (code ISO destination, ex. "BF")
  product_name text not null,               -- details[].product.name
  shipment_date date,                       -- expedition.date
  arrival_date timestamptz,                 -- expedition.arrivalDate
  source_country text,                      -- expedition.country (origine, code ISO)
  quantity_sent integer,
  quantity_arrived integer,
  quantity_defected integer,
  status text,                              -- expedition.status (ex. "received")
  synced_at timestamptz not null default now()
);

create index if not exists mlshipafrica_shipments_country_idx on mlshipafrica_shipments (country);
create index if not exists mlshipafrica_shipments_shipment_date_idx on mlshipafrica_shipments (shipment_date);

alter table mlshipafrica_shipments enable row level security;

drop policy if exists "Allow read for authenticated users" on mlshipafrica_shipments;
create policy "Allow read for authenticated users"
  on mlshipafrica_shipments for select
  to authenticated
  using (true);
