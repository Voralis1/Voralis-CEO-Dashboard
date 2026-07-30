-- Instantané du dashboard WEB Shipsen — PAS via /orders/search ou /shippings/search (l'API
-- "publique" utilisée par scripts/sync/sync_shipsen.py pour les tables shipsen_leads/
-- shipsen_orders), mais via l'endpoint réel que le dashboard web appelle en interne :
-- GET /analytics/getTotalOrdersPaid?DateType=thismonth&Response=ConfirmationRate|Delivery
-- (trouvé le 2026-07-29 en inspectant le trafic réseau du dashboard dans le navigateur — non
-- documenté officiellement, mais confirmé fiable : les totaux calculés en sommant son découpage
-- journalier matchent EXACTEMENT ce qu'affiche l'écran, validé en direct avec le CEO).
--
-- Pourquoi cette table (2026-07-21, requalifiée le 2026-07-29) : le CEO a signalé un écart entre
-- le dashboard natif Shipsen et le dashboard CEO (ex. Guinée "This Month" : 201 confirmées côté
-- Shipsen vs 194 côté kpi_shipsen_marche_periode, 13 "Processed" côté Shipsen vs 73 en base).
-- Root cause : /shippings/search ne réexpose plus un shipment une fois qu'il a avancé au-delà
-- d'un certain stade, donc shipsen_orders reste figé sur un statut périmé pour ces lignes (voir
-- n8n/shipsen-sync.workflow.json, fix synced_at du même jour). /analytics/getTotalOrdersPaid,
-- lui, reflète l'état réellement à jour — cette table le complète SANS remplacer shipsen_leads/
-- shipsen_orders (ca_livre/revenue_delivered restent fiables car basés sur paid_at/processed_at,
-- une date d'événement immuable qui ne souffre pas de ce problème de staleness).
--
-- ⚠️ Limite connue : DateType n'accepte fiablement que 'today'/'yesterday'/'thismonth'/
-- 'lastmonth' (vérifié en direct — toute autre valeur retombe silencieusement sur un comportement
-- par défaut) — pas de plage de dates arbitraire comme le sélecteur "De/À" du dashboard CEO. Cette
-- table ne remplace donc le calcul existant QUE quand la période sélectionnée correspond à un de
-- ces 4 préréglages.
--
-- Une ligne PAR JOUR PAR PAYS (pas un upsert qui écrase silencieusement) : sert d'historique pour
-- comparer l'évolution du funnel dans le temps (raw_text conserve les 2 réponses JSON brutes pour
-- audit). model_used est un champ hérité d'un plan de scraping IA abandonné (inutile désormais,
-- laissé NULL) — voir scripts/sync/sync_shipsen.py, fonction sync_analytics_snapshot.

create table if not exists shipsen_dashboard_snapshot (
  id bigint generated always as identity primary key,
  country text not null,
  period_label text not null,              -- 'this_month' pour l'instant — extensible si on scrape d'autres périodes
  snapshot_date date not null,              -- date du jour où le scraping a eu lieu (pas la période affichée)
  confirmation_rate numeric,
  confirmed_orders integer,
  total_orders integer,
  cancelled_orders integer,
  delivery_rate numeric,
  total_shippings integer,
  received integer,
  paid integer,
  cancelled_shipments integer,
  processed integer,
  raw_text text,                            -- texte brut scrappé, tronqué — audit si l'IA extrait mal un jour
  model_used text,                          -- slug OpenRouter du modèle utilisé (traçabilité si on change de modèle)
  synced_at timestamptz not null default now()
);

create unique index if not exists shipsen_dashboard_snapshot_unique_idx
  on shipsen_dashboard_snapshot (country, period_label, snapshot_date);

create index if not exists shipsen_dashboard_snapshot_country_idx
  on shipsen_dashboard_snapshot (country);

alter table shipsen_dashboard_snapshot enable row level security;

drop policy if exists "Allow read for authenticated users" on shipsen_dashboard_snapshot;
create policy "Allow read for authenticated users"
  on shipsen_dashboard_snapshot for select
  to authenticated
  using (true);

grant select on shipsen_dashboard_snapshot to authenticated;
