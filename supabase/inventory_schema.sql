-- Module "Stock & Inventaire" — suivi manuel du stock physique par pays/produit, avec seuil
-- de réapprovisionnement calculé (pas stocké) à partir des ventes réelles. Run this once in
-- Supabase → SQL Editor.
--
-- Choix de conception (validé) : ventes_moyennes_jour et seuil_alerte ne sont PAS stockés —
-- ils se calculent à la volée depuis les commandes livrées (voir kpi_*_par_produit_periode
-- dans inventory_par_produit_migration.sql), pour ne jamais avoir deux sources qui divergent.
--
-- NULL vs 0 : delai_appro_jours/stock_securite à NULL = paramètre non configuré (statut "⚪ Non
-- configuré"), jamais confondu avec 0 qui serait une vraie valeur (délai nul, pas de stock de
-- sécurité). quantite_stock, elle, est toujours un état réel connu — pas de nullable ici.

create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  pays text not null
    check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire')),
  produit text not null,
  quantite_stock numeric(18, 2) not null default 0,
  delai_appro_jours integer,
  stock_securite numeric(18, 2),
  ventes_moyennes_jour_override numeric(18, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pays, produit)
);

create index if not exists inventory_pays_idx on inventory (pays);

alter table inventory enable row level security;

create policy "Allow read for authenticated users"
  on inventory for select
  to authenticated
  using (true);

-- Pas de policy insert/update/delete pour "authenticated" : les écritures passent
-- exclusivement par l'API serveur (supabaseAdmin), elle-même réservée au rôle CEO
-- (cf. app/api/inventory/route.ts) — le "gestion stock" viendra affiner ça plus tard.

drop trigger if exists inventory_set_updated_at on inventory;
create trigger inventory_set_updated_at
  before update on inventory
  for each row
  execute function set_updated_at(); -- fonction déjà créée par market_settings_schema.sql

grant select on inventory to authenticated;
