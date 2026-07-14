-- ClickMarket integration schema
-- Run this once in Supabase → SQL Editor.
-- Source: https://clickmarket-backend-8scjo.ondigitalocean.app/api/orders-paginated
-- orders_type=leads (page "Orders", pas "Shipping Orders" — revert 2026-07-14) : le CEO a
-- confirmé en comparant aux widgets natifs ClickMarket que /orders-paginated?orders_type=leads
-- contient déjà les bonnes données de livraison (shipping_status/delivered_at identiques,
-- vérifié en direct) pour les commandes expédiées — donc pas besoin d'une seconde source pour
-- "Livrées", "leads" est un sur-ensemble de "orders" qui suffit pour tout calculer.

create table if not exists clickmarket_leads (
  order_id text primary key,               -- business reference, e.g. "GA-51169782"
  internal_id bigint,                       -- ClickMarket's numeric `id`
  country_id integer not null,
  country_name text not null,               -- denormalized from order.country.name
  customer_name text,
  customer_city text,
  total_price numeric not null default 0,
  quantity integer,
  confirmation_status text,                 -- order.confirmation_status.name (e.g. "confirmed", "remind")
  shipping_status text,                     -- order.shipping_status.name (e.g. "processed", "to_prepare")
  seller_payment_status text,               -- "paid" / "unpaid"
  product_name text,                        -- order.order_items[0].product.name
  confirmation_agent text,                  -- order.confirmation_agent.first_name + last_name
  order_date date not null,
  order_created_at timestamptz,             -- order.created_at (ClickMarket side)
  confirmed_at timestamptz,
  delivered_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists clickmarket_leads_country_idx on clickmarket_leads (country_id);
create index if not exists clickmarket_leads_order_date_idx on clickmarket_leads (order_date);

alter table clickmarket_leads enable row level security;

drop policy if exists "Allow read for authenticated users" on clickmarket_leads;
create policy "Allow read for authenticated users"
  on clickmarket_leads for select
  to authenticated
  using (true);

-- KPI par marché (pays), calcul instantané côté Postgres.
-- security_invoker = true : la vue respecte les policies RLS de clickmarket_leads
-- au lieu de s'exécuter avec les droits du propriétaire de la vue.
create or replace view kpi_clickmarket_marche
  with (security_invoker = true) as
select
  country_id,
  max(country_name) as country_name,
  count(*) as total_leads,
  count(*) filter (where confirmed_at is not null) as confirmes,
  round(
    100.0 * count(*) filter (where confirmed_at is not null) / nullif(count(*), 0),
    1
  ) as taux_confirmation,
  count(*) filter (where delivered_at is not null) as livres,
  round(
    100.0 * count(*) filter (where delivered_at is not null)
      / nullif(count(*) filter (where confirmed_at is not null), 0),
    1
  ) as taux_livraison,
  coalesce(sum(total_price) filter (where delivered_at is not null), 0) as ca_livre
from clickmarket_leads
group by country_id;

-- Variante filtrée par période, pour respecter le sélecteur de dates du dashboard (De / À).
-- Le funnel (leads/confirmées/taux) reste basé sur la date de CRÉATION (order_date) — c'est un
-- indicateur d'entonnoir, pas un montant. Seul ca_livre bascule sur la date de LIVRAISON
-- (delivered_at), conformément à la règle "l'argent n'existe que sur commande livrée et
-- encaissée" : une commande livrée pendant la période compte dans ca_livre même si elle a été
-- créée avant la fenêtre sélectionnée (et une commande créée dans la fenêtre mais pas encore
-- livrée n'y contribue pas).
-- FULL OUTER JOIN entre les deux sous-requêtes : un pays qui n'a livré/encaissé que des
-- commandes créées hors fenêtre doit quand même apparaître avec son ca_livre correct (sinon
-- cet argent disparaîtrait silencieusement du rapport).
-- Utilisation : select * from kpi_clickmarket_marche_periode('2026-06-01', '2026-06-30');
-- Extension : en_attente/annulees/rupture_stock/doublons, ajoutés pour le tableau prestataire
-- partagé (colonnes strictement identiques sur les 4 réseaux). Mapping validé sur données
-- réelles (audit des valeurs distinctes de confirmation_status/shipping_status) :
--   - doublons        : confirmation_status = 'double' (exclu du calcul des taux, affiché à part)
--   - rupture_stock   : confirmation_status = 'out_of_stock' — perte de leads réels (reste dans
--                       total_leads) mais distincte d'une annulation, propre à ClickMarket
--   - confirmes/taux_confirmation/en_attente/rupture_stock : conservés tels quels (funnel de
--                       confirmation) — utilisés par les alertes de la page d'accueil
--                       (lib/dashboardData.ts), pas affichés dans le tableau Réseaux
--                       Logistiques/COD depuis 2026-07.
--   - livres/taux_livraison/ca_livre/retournees : redéfinis sur shipping_status (2026-07) —
--                       mapping confirmé sur données réelles (audit en direct) :
--                       shipping_status='processed' est corrélé à ~100% avec delivered_at non
--                       nul ET seller_payment_status='paid' (livré + encaissé, la seule vraie
--                       vente) — 'delivered'/'paid' ajoutés au filtre livres/ca_livre (2026-07-14,
--                       demande CEO). retournees = shipping_status='return', une valeur réelle
--                       qui existe (audité), remplace l'ancien "non exposé".
--   - annulees          : confirmation_status='cancelled' (2026-07-14, ex shipping_status —
--                       corrigé pour matcher le widget natif ClickMarket "Résumé de la
--                       confirmation", qui compte les leads rejetés à l'appel, pas les échecs de
--                       livraison).
--                       ca_livre déduit 11$ de frais de livraison fixe par commande livrée
--                       (même frais que les 6 pays externes, cf. field cash Angola).
--                       taux_livraison passe de livres/confirmes à livres/total_leads : sans
--                       "confirmes" dans ce tableau, le taux de livraison se lit maintenant sur
--                       l'ensemble des commandes, pas seulement sur les confirmées.
--   - livres déplacé du CTE funnel vers revenu_livre (2026-07-13) : compté sur delivered_at
--                       (même fenêtre que ca_livre), plus sur order_date. Avant ce changement,
--                       une commande CRÉÉE dans la fenêtre mais dont la livraison arrive des
--                       semaines plus tard comptait 0 sur toute fenêtre courte (bug remonté par
--                       le CEO : "Livrées" à 0 malgré des livraisons réelles sur la période).
--   - confirmes déplacé du CTE funnel vers un CTE confirmation dédié (2026-07-14) : compté sur
--                       confirmed_at, plus sur order_date — même bug que livres/order_date, mais
--                       cette fois repéré par le CEO en comparant au widget natif ClickMarket
--                       "Résumé de la confirmation" (regroupé par date de confirmation, pas de
--                       création). taux_confirmation reste confirmes/total_leads (total_leads
--                       reste sur order_date, décision non revisitée ici).
--                       ⚠️ Tenté d'exclure confirmation_status/shipping_status='cancelled'
--                       (2026-07-14) sur la base d'un seul exemple (5 confirmed_at dont 2 annulées
--                       → CEO avait rapporté "3" côté widget, sans capture) — CONTREDIT par un
--                       échantillon plus large ("This Year" : 131 confirmed_at en base, widget
--                       affiche 132, quasi-exact ; avec l'exclusion ça tombait à 38). Le widget
--                       natif ClickMarket ne semble PAS exclure les commandes annulées après
--                       confirmation — reverti au comptage simple confirmed_at, sans filtre de
--                       statut. Le petit écart (131 vs 132, 33 vs 34 sur juin) est le même
--                       artefact de frontière déjà documenté (confirmed_at est un timestamp
--                       complet, la borne de "This Year"/"Last Month" côté ClickMarket n'est pas
--                       forcément un jour calendaire strict en UTC).
--   - total_leads déplacé du CTE funnel vers un CTE total dédié (2026-07-14) : compté sur
--                       order_created_at, plus sur order_date — vérifié sur 2 fenêtres
--                       différentes contre le widget natif "Total Commandes" (18 vs 21 sur une
--                       fenêtre, 183 vs 195 sur une autre — created_at systématiquement plus
--                       proche/exact). taux_confirmation et taux_livraison utilisent maintenant
--                       ce total_leads (created_at) comme dénominateur.
--   - Décalage horaire WAT (2026-07-14) : Gabon/Congo/Angola sont en WAT (UTC+1). Nos colonnes
--                       timestamptz sont stockées en UTC ; caster directement `col::date` lit
--                       donc "aujourd'hui" avec 1h de retard par rapport à l'heure locale (une
--                       commande créée à 23h30 UTC = 00h30 WAT le lendemain, donc "aujourd'hui"
--                       pour le widget natif mais encore "hier" pour nous). Vérifié précisément
--                       sur Coliscod "Aujourd'hui" : filtre UTC = 68, filtre décalé +1h = 72,
--                       widget natif = 72 (match exact). Fix appliqué aux 3 dates concernées
--                       (order_created_at, confirmed_at, delivered_at) en castant
--                       `(col + interval '1 hour')::date` au lieu de `col::date` — équivalent à
--                       lire la date en heure locale WAT plutôt qu'en UTC.
drop function if exists kpi_clickmarket_marche_periode(date, date);
create or replace function kpi_clickmarket_marche_periode(date_from date, date_to date)
returns table (
  country_id integer,
  country_name text,
  total_leads bigint,
  confirmes bigint,
  taux_confirmation numeric,
  livres bigint,
  taux_livraison numeric,
  ca_livre numeric,
  en_attente bigint,
  annulees bigint,
  rupture_stock bigint,
  doublons bigint,
  retournees bigint
)
language sql
security invoker
stable
as $$
  with total as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) as total_leads
    from clickmarket_leads
    where order_created_at is not null
      and (order_created_at + interval '1 hour')::date between date_from and date_to
    group by country_id
  ),
  funnel as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) filter (where confirmation_status = 'double') as doublons,
      count(*) filter (where confirmation_status = 'out_of_stock') as rupture_stock,
      count(*) filter (where confirmation_status = 'cancelled') as annulees,
      count(*) filter (where shipping_status = 'return') as retournees,
      count(*) filter (
        where delivered_at is null
          and confirmation_status is distinct from 'cancelled'
          and shipping_status is distinct from 'cancelled'
          and confirmation_status is distinct from 'double'
          and confirmation_status is distinct from 'out_of_stock'
      ) as en_attente
    from clickmarket_leads
    where order_date between date_from and date_to
    group by country_id
  ),
  confirmation as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) as confirmes
    from clickmarket_leads
    where confirmed_at is not null
      and (confirmed_at + interval '1 hour')::date between date_from and date_to
    group by country_id
  ),
  revenu_livre as (
    select
      country_id,
      max(country_name) as country_name,
      count(*) as livres,
      coalesce(sum(total_price), 0) - 11 * count(*) as ca_livre
    from clickmarket_leads
    where shipping_status in ('processed', 'delivered', 'paid')
      and delivered_at is not null
      and (delivered_at + interval '1 hour')::date between date_from and date_to
    group by country_id
  )
  select
    coalesce(t.country_id, f.country_id, c.country_id, r.country_id) as country_id,
    coalesce(t.country_name, f.country_name, c.country_name, r.country_name) as country_name,
    coalesce(t.total_leads, 0) as total_leads,
    coalesce(c.confirmes, 0) as confirmes,
    round(100.0 * coalesce(c.confirmes, 0) / nullif(t.total_leads, 0), 1) as taux_confirmation,
    coalesce(r.livres, 0) as livres,
    round(100.0 * coalesce(r.livres, 0) / nullif(t.total_leads, 0), 1) as taux_livraison,
    coalesce(r.ca_livre, 0) as ca_livre,
    coalesce(f.en_attente, 0) as en_attente,
    coalesce(f.annulees, 0) as annulees,
    coalesce(f.rupture_stock, 0) as rupture_stock,
    coalesce(f.doublons, 0) as doublons,
    coalesce(f.retournees, 0) as retournees
  from total t
  full outer join funnel f on f.country_id = t.country_id
  full outer join confirmation c on c.country_id = coalesce(t.country_id, f.country_id)
  full outer join revenu_livre r on r.country_id = coalesce(t.country_id, f.country_id, c.country_id);
$$;

grant select on kpi_clickmarket_marche to authenticated;
grant execute on function kpi_clickmarket_marche_periode(date, date) to authenticated;
