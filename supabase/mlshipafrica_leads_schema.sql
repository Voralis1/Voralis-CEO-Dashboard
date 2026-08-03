-- MLShipAfrica leads integration schema (source /orders/search) — complète
-- mlshipafrica_schema.sql (shippings). Run this once in Supabase → SQL Editor, avant
-- mlshipafrica_schema.sql.
-- Même plateforme backend que Shipsen (voir scripts/sync/shipsen_family_common.py), mais SANS
-- notion d'entrepôt (pas de colonne warehouse_id, contrairement à shipsen_leads/shiplead_leads) —
-- le paramètre `warehouse` de l'API renvoie systématiquement "no orders found" quel que soit ce
-- qu'on lui passe (testé en direct le 2026-08-03), l'omettre renvoie le flux global multi-pays.
-- Le pays de chaque commande se lit sur customer.country (voir sync_mlshipafrica.py).
--
-- Vocabulaire de order.status.name audité en direct (~500 commandes, 2026-08-03) :
--   Pending, Cancelled, Confirmed, Unreached, "double" (minuscule) — le statut "double" existe
--   ici (contrairement à Shipsen/ShipLead), colonne doublons donc réellement peuplée sur ce
--   réseau, pas gardée à 0 par cohérence structurelle comme sur les 2 autres.
--
-- Devise absente de l'API — complétée via la zone CFA (UEMOA=XOF, CEMAC=XAF) dans
-- sync_mlshipafrica.py (COUNTRY_CURRENCY), connaissance de domaine fiable pour les 7 marchés du
-- compte (CI/TG/ML/CG/BJ/TD/BF).

create table if not exists mlshipafrica_leads (
  mongo_id text primary key,                -- _id de l'ORDER (pas du shipping) — unique globalement
  order_id text not null,                   -- order.id, l'id lisible MLShipAfrica
  country text not null,                    -- code ISO alpha-2 (customer.country)
  currency text not null,
  customer_name text,
  customer_phone text,
  product_name text,
  quantity integer,
  unit_price numeric,
  total_price numeric not null default 0,
  status_name text not null,                -- Pending/Cancelled/Unreached/Confirmed/double
  order_date timestamptz not null,
  created_at timestamptz,
  updated_at timestamptz,
  unreached_count integer,
  last_unreached_date timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists mlshipafrica_leads_country_idx on mlshipafrica_leads (country);
create index if not exists mlshipafrica_leads_order_date_idx on mlshipafrica_leads (order_date);

alter table mlshipafrica_leads enable row level security;

drop policy if exists "Allow read for authenticated users" on mlshipafrica_leads;
create policy "Allow read for authenticated users"
  on mlshipafrica_leads for select
  to authenticated
  using (true);
