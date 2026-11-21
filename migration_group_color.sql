-- Grupper: färg + "visa alltid på kartan"
alter table public.groups add column if not exists color text default '#e23b3b';
alter table public.groups add column if not exists always_visible boolean default false;

-- Boenden får distinkt färg (lila) och visas alltid (om en sådan grupp finns)
update public.groups
set color = '#7c3aed', always_visible = true
where coalesce(always_visible, false) = false
  and lower(name) ~ '(boende|hotell|accommod|lodg|apartment|lägenhet|stuga|hostel)';

-- Be PostgREST ladda om schemat så nya kolumner syns via API:t direkt
notify pgrst, 'reload schema';
