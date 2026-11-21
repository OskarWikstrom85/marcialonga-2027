-- Dagsplaner för skidsystemet (sekvens av liftar + nedfarter)
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  area_id text not null default 'canazei',
  name text not null,
  steps jsonb not null default '[]'::jsonb,
  sort int not null default 0,
  created timestamptz default now()
);
alter table public.plans enable row level security;
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (true);
drop policy if exists plans_write on public.plans;
create policy plans_write on public.plans for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
notify pgrst, 'reload schema';
