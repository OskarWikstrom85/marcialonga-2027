-- =====================================================================
--  Marcialonga 2027 – Supabase-schema
--  Kör hela denna fil i Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

-- 1) Tabell för hållpunkter --------------------------------------------
create table if not exists public.waypoints (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text,
  icon       text default 'info',           -- start | finish | peak | food | info | default
  lng        double precision not null,
  lat        double precision not null,
  image_url  text,
  sort       int default 0,
  created_at timestamptz default now()
);

-- 2) Radsäkerhet (RLS): alla får läsa, bara inloggade får ändra --------
alter table public.waypoints enable row level security;

drop policy if exists "waypoints read all"   on public.waypoints;
drop policy if exists "waypoints insert auth" on public.waypoints;
drop policy if exists "waypoints update auth" on public.waypoints;
drop policy if exists "waypoints delete auth" on public.waypoints;

create policy "waypoints read all"   on public.waypoints for select using (true);
create policy "waypoints insert auth" on public.waypoints for insert to authenticated with check (true);
create policy "waypoints update auth" on public.waypoints for update to authenticated using (true) with check (true);
create policy "waypoints delete auth" on public.waypoints for delete to authenticated using (true);

-- 3) Realtidsuppdatering (ändringar syns direkt för besökare) ----------
do $$
begin
  begin
    alter publication supabase_realtime add table public.waypoints;
  exception when duplicate_object then null;
  end;
end $$;

-- 4) Lagringshink för bilder -------------------------------------------
insert into storage.buckets (id, name, public)
values ('waypoint-images', 'waypoint-images', true)
on conflict (id) do nothing;

drop policy if exists "images read all"   on storage.objects;
drop policy if exists "images insert auth" on storage.objects;
drop policy if exists "images update auth" on storage.objects;
drop policy if exists "images delete auth" on storage.objects;

create policy "images read all"   on storage.objects for select using (bucket_id = 'waypoint-images');
create policy "images insert auth" on storage.objects for insert to authenticated with check (bucket_id = 'waypoint-images');
create policy "images update auth" on storage.objects for update to authenticated using (bucket_id = 'waypoint-images');
create policy "images delete auth" on storage.objects for delete to authenticated using (bucket_id = 'waypoint-images');

-- 5) Exempelpunkter (kan ändras/tas bort i appen efteråt) --------------
insert into public.waypoints (title, body, icon, lng, lat, sort) values
  ('Start – Moena',            'Loppet startar i Moena och går först uppför Fassadalen mot Canazei.', 'start',  11.6633, 46.3775, 1),
  ('Vändpunkt – Canazei',      'Banans högsta och nordligaste punkt, under Dolomiternas toppar. Här vänder spåret.', 'peak', 11.7700, 46.4767, 2),
  ('Predazzo',                 'Infart i Fiemmedalen efter nerfarten från Fassa.', 'info', 11.5986, 46.3119, 3),
  ('Lago di Tesero – stadion', 'Längdskidstadion i Tesero, van vid världscup och VM.', 'food', 11.5200, 46.2850, 4),
  ('Molina di Fiemme',         'Banans lägsta punkt – härifrån väntar slutstigningen mot målet.', 'info', 11.4333, 46.2667, 5),
  ('Mål – Cavalese',           'Målgång i Cavalese efter 70 km.', 'finish', 11.4606, 46.2906, 6)
on conflict do nothing;
