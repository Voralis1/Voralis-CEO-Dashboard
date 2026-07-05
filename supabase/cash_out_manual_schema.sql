-- Cash Out — entrées saisies manuellement (salaires locaux, autres frais). Les payouts
-- affiliés sont volontairement EXCLUS de cette table : ils viendront de l'API CRM Voralis
-- (évolution prévue séparément) — pas de double saisie.
-- Run this once in Supabase → SQL Editor.

create table if not exists cash_out_manual (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('salaire_local', 'autre')),
  pays text not null
    check (pays in ('Angola', 'Gabon', 'Congo', 'Mali', 'Guinée', 'Sénégal', 'Côte d''Ivoire')),
  montant numeric(18, 2) not null,
  description text,
  date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cash_out_manual_pays_idx on cash_out_manual (pays);
create index if not exists cash_out_manual_date_idx on cash_out_manual (date);

alter table cash_out_manual enable row level security;

create policy "Allow read for authenticated users"
  on cash_out_manual for select
  to authenticated
  using (true);

-- Pas de policy insert/update/delete pour "authenticated" : écritures via l'API serveur
-- (supabaseAdmin) uniquement, depuis l'écran CEO sur /ceo.

drop trigger if exists cash_out_manual_set_updated_at on cash_out_manual;
create trigger cash_out_manual_set_updated_at
  before update on cash_out_manual
  for each row
  execute function set_updated_at();

grant select on cash_out_manual to authenticated;
