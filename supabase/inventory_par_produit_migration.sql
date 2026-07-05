-- Extension des 4 réseaux COD : agrégation PAR PRODUIT (en plus de par pays), pour le module
-- Stock & Inventaire — ventes_moyennes_jour (livrées) et taux de rupture de stock
-- (out_of_stock, ClickMarket uniquement — les 3 autres réseaux n'exposent pas ce statut,
-- taux_rupture_stock renvoie NULL pour eux, jamais 0, pour ne pas laisser croire à "zéro
-- rupture" alors que la donnée n'existe simplement pas côté source).
--
-- Même logique funnel (order_date) / livraison (delivered_at ou processed_at) que les
-- fonctions kpi_*_marche_periode existantes — additif, aucune fonction existante modifiée.
--
-- Index ajoutés pour que le calcul à la volée (par pays/produit/période) reste rapide même
-- avec beaucoup de commandes, conformément à la demande de vigilance perf.

create index if not exists clickmarket_leads_country_product_delivered_idx
  on clickmarket_leads (country_id, product_name, delivered_at);
create index if not exists coliscod_leads_country_product_delivered_idx
  on coliscod_leads (country_id, product_name, delivered_at);
create index if not exists africod_congo_leads_country_product_delivered_idx
  on africod_congo_leads (country_id, product_name, delivered_at);
create index if not exists shipsen_orders_country_product_processed_idx
  on shipsen_orders (country, product_name, processed_at);

-- ─── ClickMarket ────────────────────────────────────────────────────────────────────────────
create or replace function kpi_clickmarket_par_produit_periode(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  product_name text,
  total_leads bigint,
  rupture_stock bigint,
  taux_rupture_stock numeric,
  livres bigint
)
language sql
security invoker
stable
as $$
  with funnel as (
    select
      country_id,
      max(country_name) as country_name,
      coalesce(product_name, '(non renseigné)') as product_name,
      count(*) as total_leads,
      count(*) filter (where confirmation_status = 'out_of_stock') as rupture_stock
    from clickmarket_leads
    where order_date between date_from and date_to
    group by country_id, coalesce(product_name, '(non renseigné)')
  ),
  revenu_livre as (
    select
      country_id,
      coalesce(product_name, '(non renseigné)') as product_name,
      count(*) as livres
    from clickmarket_leads
    where delivered_at is not null
      and delivered_at::date between date_from and date_to
    group by country_id, coalesce(product_name, '(non renseigné)')
  )
  select
    coalesce(f.country_id, r.country_id) as country_id,
    f.country_name,
    coalesce(f.product_name, r.product_name) as product_name,
    coalesce(f.total_leads, 0) as total_leads,
    coalesce(f.rupture_stock, 0) as rupture_stock,
    round(100.0 * coalesce(f.rupture_stock, 0) / nullif(f.total_leads, 0), 1) as taux_rupture_stock,
    coalesce(r.livres, 0) as livres
  from funnel f
  full outer join revenu_livre r on r.country_id = f.country_id and r.product_name = f.product_name;
$$;

grant execute on function kpi_clickmarket_par_produit_periode(date, date) to authenticated;

-- ─── Coliscod Angola (pas de statut out_of_stock : taux_rupture_stock = NULL) ─────────────
create or replace function kpi_coliscod_par_produit_periode(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  product_name text,
  total_leads bigint,
  rupture_stock bigint,
  taux_rupture_stock numeric,
  livres bigint
)
language sql
security invoker
stable
as $$
  with funnel as (
    select
      country_id,
      max(country_name) as country_name,
      coalesce(product_name, '(non renseigné)') as product_name,
      count(*) as total_leads
    from coliscod_leads
    where order_date between date_from and date_to
    group by country_id, coalesce(product_name, '(non renseigné)')
  ),
  revenu_livre as (
    select
      country_id,
      coalesce(product_name, '(non renseigné)') as product_name,
      count(*) as livres
    from coliscod_leads
    where delivered_at is not null
      and delivered_at::date between date_from and date_to
    group by country_id, coalesce(product_name, '(non renseigné)')
  )
  select
    coalesce(f.country_id, r.country_id) as country_id,
    f.country_name,
    coalesce(f.product_name, r.product_name) as product_name,
    coalesce(f.total_leads, 0) as total_leads,
    0::bigint as rupture_stock,
    null::numeric as taux_rupture_stock,
    coalesce(r.livres, 0) as livres
  from funnel f
  full outer join revenu_livre r on r.country_id = f.country_id and r.product_name = f.product_name;
$$;

grant execute on function kpi_coliscod_par_produit_periode(date, date) to authenticated;

-- ─── Africod Congo (pas de statut out_of_stock : taux_rupture_stock = NULL) ────────────────
create or replace function kpi_africod_congo_par_produit_periode(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  product_name text,
  total_leads bigint,
  rupture_stock bigint,
  taux_rupture_stock numeric,
  livres bigint
)
language sql
security invoker
stable
as $$
  with funnel as (
    select
      country_id,
      max(country_name) as country_name,
      coalesce(product_name, '(non renseigné)') as product_name,
      count(*) as total_leads
    from africod_congo_leads
    where order_date between date_from and date_to
    group by country_id, coalesce(product_name, '(non renseigné)')
  ),
  revenu_livre as (
    select
      country_id,
      coalesce(product_name, '(non renseigné)') as product_name,
      count(*) as livres
    from africod_congo_leads
    where delivered_at is not null
      and delivered_at::date between date_from and date_to
    group by country_id, coalesce(product_name, '(non renseigné)')
  )
  select
    coalesce(f.country_id, r.country_id) as country_id,
    f.country_name,
    coalesce(f.product_name, r.product_name) as product_name,
    coalesce(f.total_leads, 0) as total_leads,
    0::bigint as rupture_stock,
    null::numeric as taux_rupture_stock,
    coalesce(r.livres, 0) as livres
  from funnel f
  full outer join revenu_livre r on r.country_id = f.country_id and r.product_name = f.product_name;
$$;

grant execute on function kpi_africod_congo_par_produit_periode(date, date) to authenticated;

-- ─── Shipsen (pas de statut out_of_stock : taux_rupture_stock = NULL) ──────────────────────
create or replace function kpi_shipsen_par_produit_periode(date_from date, date_to date)
returns table (
  country text,
  product_name text,
  total_orders bigint,
  rupture_stock bigint,
  taux_rupture_stock numeric,
  livres bigint
)
language sql
security invoker
stable
as $$
  with funnel as (
    select
      country,
      coalesce(product_name, '(non renseigné)') as product_name,
      count(*) as total_orders
    from shipsen_orders
    where order_date::date between date_from and date_to
    group by country, coalesce(product_name, '(non renseigné)')
  ),
  revenu_livre as (
    select
      country,
      coalesce(product_name, '(non renseigné)') as product_name,
      count(*) as livres
    from shipsen_orders
    where is_processed = true
      and not is_refunded
      and processed_at is not null
      and processed_at::date between date_from and date_to
    group by country, coalesce(product_name, '(non renseigné)')
  )
  select
    coalesce(f.country, r.country) as country,
    coalesce(f.product_name, r.product_name) as product_name,
    coalesce(f.total_orders, 0) as total_orders,
    0::bigint as rupture_stock,
    null::numeric as taux_rupture_stock,
    coalesce(r.livres, 0) as livres
  from funnel f
  full outer join revenu_livre r on r.country = f.country and r.product_name = f.product_name;
$$;

grant execute on function kpi_shipsen_par_produit_periode(date, date) to authenticated;
