-- ClickMarket product shipments (stock entrant fournisseur → warehouse) integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://clickmarket-backend-8scjo.ondigitalocean.app/api/product-shipments
-- Une ligne par (shipment, produit) — un même shipment peut contenir plusieurs produits
-- (shipment_items[]), aplatis ici comme pour order_items sur clickmarket_leads.

create table if not exists clickmarket_shipments (
  item_id bigint primary key,               -- shipment_items[].id — unique par item, pas par shipment
  shipment_id bigint not null,              -- shipment.id (plusieurs lignes peuvent partager le même)
  country text not null,                    -- warehouse.country.name
  product_name text not null,               -- shipment_items[].product.name
  shipment_date date,                       -- date d'expédition
  arrival_date timestamptz,                 -- date de réception
  source_country text,                      -- origine (pays d'expédition, ex. "Morocco")
  quantity_sent integer,
  quantity_arrived integer,
  quantity_defected integer,
  status text,                              -- shipment.shipment_status (ex. "received")
  synced_at timestamptz not null default now()
);

create index if not exists clickmarket_shipments_country_idx on clickmarket_shipments (country);
create index if not exists clickmarket_shipments_shipment_date_idx on clickmarket_shipments (shipment_date);

alter table clickmarket_shipments enable row level security;

drop policy if exists "Allow read for authenticated users" on clickmarket_shipments;
create policy "Allow read for authenticated users"
  on clickmarket_shipments for select
  to authenticated
  using (true);