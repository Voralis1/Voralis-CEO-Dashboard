-- Ikatchiexpress integration schema. Run this once in Supabase → SQL Editor.
-- Source : https://api.atlasswift.com/api/seller/orders (portail seller.atlasswift.com).
-- Plateforme "AtlasSwift" — architecture DIFFÉRENTE des 2 familles déjà intégrées (Shipsen,
-- AfricaCOD) : un seul endpoint, un seul champ `status` (français) couvrant tout le cycle de vie
-- de la commande (pas de split confirmation_status/shipping_status ni leads/shippings séparés).
--
-- ⚠️ Compte minuscule au moment d'écrire ce schéma (4 commandes de test, 2026-08-04) :
-- vocabulaire de `status` réellement observé : "Annulée", "À rappeler", "Retourner".
-- "Confirmée"/"Livrée" sont des suppositions de vocabulaire standard, JAMAIS vues en vrai —
-- la fonction KPI ci-dessous classe prudemment tout statut non reconnu comme confirmé/annulé
-- dans "en attente" (jamais confondu avec confirmé/livré par erreur). À RÉ-AUDITER dès que le
-- compte aura un volume réel (voir sync_ikatchiexpress.py pour le même avertissement).
--
-- Devise : total_price/currency_code est déjà dans la devise LOCALE du pays de livraison
-- (arrival_country) — pas besoin d'une table de correspondance pays->devise codée en dur comme
-- pour MLShipAfrica (l'API donne directement la bonne devise).
--
-- Pas de confirmed_at/delivered_at dédiés côté API — comme Shipsen/AfricaCOD, `updated_at` sert
-- de repli pour dater un changement de statut (même limite déjà documentée ailleurs).

create table if not exists ikatchiexpress_orders (
  order_id text primary key,
  seller_id text,
  country text not null,                    -- code ISO alpha-2 (arrival_country, ex. "ML", "MA")
  currency text not null,
  customer_name text,
  customer_phone text,
  customer_address text,
  product_name text,
  quantity integer,
  unit_price numeric,
  total_price numeric not null default 0,
  delivery_fee numeric not null default 0,
  status text not null,                     -- français, voir avertissement ci-dessus
  order_date timestamptz not null,          -- = created_at (pas d'autre date de référence côté API)
  created_at timestamptz,
  updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists ikatchiexpress_orders_country_idx on ikatchiexpress_orders (country);
create index if not exists ikatchiexpress_orders_order_date_idx on ikatchiexpress_orders (order_date);

alter table ikatchiexpress_orders enable row level security;

drop policy if exists "Allow read for authenticated users" on ikatchiexpress_orders;
create policy "Allow read for authenticated users"
  on ikatchiexpress_orders for select
  to authenticated
  using (true);

-- KPI par marché filtré par période — même forme de sortie que kpi_shipsen_marche_periode
-- (country/currency, pas country_id) pour réutiliser le même code frontend (voir
-- lib/providerKpi.ts, normalizeShipsenFamilyRow). total_orders = TOUTES les commandes créées sur
-- la période (pas confirmed+cancelled comme Shipsen — cette redéfinition était une demande CEO
-- explicite propre à Shipsen, pas une convention à copier par défaut ici sans preuve similaire).
-- Pas de delai_1er_contact_heures : aucun signal fiable côté API (pas de compteur de tentatives
-- d'appel ni de date de dernière tentative) — colonne toujours NULL plutôt que d'inventer un
-- calcul biaisé.
drop function if exists kpi_ikatchiexpress_marche_periode(date, date);
create or replace function kpi_ikatchiexpress_marche_periode(date_from date, date_to date)
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
  taux_livraison numeric,
  delai_1er_contact_heures numeric
)
language sql
security invoker
stable
as $$
  with total as (
    select
      country,
      max(currency) as currency,
      count(*) as total_orders
    from ikatchiexpress_orders
    where order_date::date between date_from and date_to
    group by country
  ),
  confirmation as (
    select
      country,
      count(*) filter (where status = 'Confirmée') as confirmed_orders,
      count(*) filter (where status = 'Annulée') as cancelled_orders,
      count(*) filter (where status not in ('Confirmée', 'Annulée')) as pending_orders,
      coalesce(sum(total_price) filter (where status = 'Confirmée'), 0) as revenue_confirmed
    from ikatchiexpress_orders
    where order_date::date between date_from and date_to
    group by country
  ),
  shipping_extra as (
    select
      country,
      count(*) filter (where status = 'Retourner') as retournees
    from ikatchiexpress_orders
    where order_date::date between date_from and date_to
    group by country
  ),
  revenu_livre as (
    select
      country,
      max(currency) as currency,
      count(*) as livres,
      coalesce(sum(total_price), 0) - 11 * count(*) as revenue_delivered
    from ikatchiexpress_orders
    where status = 'Livrée'
      and updated_at is not null
      and updated_at::date between date_from and date_to
    group by country
  )
  select
    coalesce(t.country, c.country, x.country, r.country) as country,
    coalesce(t.currency, r.currency) as currency,
    coalesce(t.total_orders, 0) as total_orders,
    coalesce(c.confirmed_orders, 0) as confirmed_orders,
    round(100.0 * coalesce(c.confirmed_orders, 0) / nullif(t.total_orders, 0), 1) as confirmation_rate,
    coalesce(c.revenue_confirmed, 0) as revenue_confirmed,
    coalesce(r.revenue_delivered, 0) as revenue_delivered,
    coalesce(c.cancelled_orders, 0) as cancelled_orders,
    coalesce(c.pending_orders, 0) as pending_orders,
    coalesce(c.pending_orders, 0) as en_attente,
    coalesce(c.cancelled_orders, 0) as annulees,
    0 as rupture_stock,
    0 as doublons,
    coalesce(x.retournees, 0) as retournees,
    coalesce(r.livres, 0) as livres,
    round(100.0 * coalesce(r.livres, 0) / nullif(t.total_orders, 0), 1) as taux_livraison,
    null::numeric as delai_1er_contact_heures
  from total t
  full outer join confirmation c on c.country = t.country
  full outer join shipping_extra x on x.country = coalesce(t.country, c.country)
  full outer join revenu_livre r on r.country = coalesce(t.country, c.country, x.country);
$$;

grant execute on function kpi_ikatchiexpress_marche_periode(date, date) to authenticated;
