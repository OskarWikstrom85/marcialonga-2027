-- =====================================================================
--  Migration: hållpunktsgrupper. Kör EN gång i Supabase (SQL Editor → Run).
-- =====================================================================

-- 1) Grupptabell
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  area_id    text not null default 'marcialonga',
  name       text not null,
  icon       text default '📍',
  sort       int default 0,
  created_at timestamptz default now()
);

alter table public.groups enable row level security;
drop policy if exists "groups read all"  on public.groups;
drop policy if exists "groups write auth" on public.groups;
create policy "groups read all"  on public.groups for select using (true);
create policy "groups write auth" on public.groups for all to authenticated using (true) with check (true);

do $$ begin
  begin alter publication supabase_realtime add table public.groups;
  exception when duplicate_object then null; end;
end $$;

-- 2) Koppling på hållpunkter
alter table public.waypoints add column if not exists group_id uuid;

-- 3) Standardgrupper per bana
insert into public.groups (area_id, name, icon, sort) values
  ('marcialonga','Info','ℹ️',1),
  ('marcialonga','Vätska & mat','🍽',2),
  ('canazei','Info','ℹ️',1),
  ('canazei','Lunch','🍽',2);

-- 4) Lägg befintliga punkter utan grupp i sin banas Info-grupp
update public.waypoints w
set group_id = g.id
from public.groups g
where w.group_id is null
  and g.area_id = coalesce(w.area_id,'marcialonga')
  and g.name = 'Info';

notify pgrst, 'reload schema';
