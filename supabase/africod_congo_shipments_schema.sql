-- Africod Congo (AfriqueCOD) product shipments (stock entrant fournisseur → warehouse) schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://api.afriquecod.com/api/product-shipments
-- Même structure que clickmarket_shipments/coliscod_shipments (même famille d'API) —
-- une ligne par (shipment, produit).

create table if not exists africod_congo_shipments (
  item_id bigint primary key,
  shipment_id bigint not null,
  country text not null,
  product_name text not null,
  shipment_date date,
  arrival_date timestamptz,
  source_country text,
  quantity_sent integer,
  quantity_arrived integer,
  quantity_defected integer,
  status text,
  synced_at timestamptz not null default now()
);

create index if not exists africod_congo_shipments_country_idx on africod_congo_shipments (country);
create index if not exists africod_congo_shipments_shipment_date_idx on africod_congo_shipments (shipment_date);

alter table africod_congo_shipments enable row level security;

drop policy if exists "Allow read for authenticated users" on africod_congo_shipments;
create policy "Allow read for authenticated users"
  on africod_congo_shipments for select
  to authenticated
  using (true);