-- Health tracker schema
-- All measurements are stored in metric (kg, ml, km); the apps convert for display.
-- Run this in the Supabase SQL editor (or `supabase db push`).

-- ───────────────────────── profiles & sharing ─────────────────────────

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text,
  units          text not null default 'imperial' check (units in ('imperial', 'metric')),
  calorie_goal   integer default 2200,
  water_goal_ml  integer default 2500,
  weight_goal_kg numeric(5, 2),
  created_at     timestamptz not null default now()
);

-- A row here lets `viewer_id` read everything owned by `owner_id` (read-only).
create table public.shares (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  viewer_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, viewer_id)
);

-- Create a profile automatically on sign-up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- True if the current user owns `p_owner` or has been granted read access to it.
create function public.can_read(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner = auth.uid()
      or exists (select 1 from public.shares s where s.owner_id = p_owner and s.viewer_id = auth.uid());
$$;

-- Owner calls this (from the app's Settings screen) to give a partner read access.
-- The partner must have signed up on the website first.
create function public.add_viewer(viewer_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(viewer_email);
  if v_id is null then
    raise exception 'No account found for %. Ask them to sign up on the website first.', viewer_email;
  end if;
  if v_id = auth.uid() then
    raise exception 'You cannot share with yourself.';
  end if;
  insert into public.shares (owner_id, viewer_id) values (auth.uid(), v_id) on conflict do nothing;
end;
$$;

-- Lets the website list whose data the signed-in user can see.
create function public.readable_owners()
returns table (owner_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name from public.profiles p where public.can_read(p.id);
$$;

-- ───────────────────────── tracking tables ─────────────────────────

create table public.weight_entries (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_at    timestamptz not null default now(),
  weight_kg      numeric(5, 2) not null check (weight_kg > 0),
  source         text not null default 'manual',      -- 'manual' | 'healthkit'
  healthkit_uuid text,
  unique (user_id, healthkit_uuid)
);

create table public.food_entries (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  eaten_at      timestamptz not null default now(),
  meal          text not null default 'snack' check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  name          text not null,
  brand         text,
  serving_desc  text,                                 -- e.g. "1 cup (240 g)"
  servings      numeric(6, 2) not null default 1,
  calories      numeric(7, 1) not null default 0,     -- totals for this entry (already × servings)
  protein_g     numeric(6, 1),
  carbs_g       numeric(6, 1),
  fat_g         numeric(6, 1),
  source        text not null default 'manual',       -- 'manual' | 'usda' | 'openfoodfacts'
  external_id   text                                  -- USDA fdcId or barcode
);

create table public.sleep_entries (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sleep_date     date not null,                       -- the date you woke up
  hours          numeric(4, 2) check (hours >= 0 and hours <= 24),
  score          integer check (score between 0 and 100),
  deep_hours     numeric(4, 2),
  rem_hours      numeric(4, 2),
  source         text not null default 'manual',
  unique (user_id, sleep_date)
);

create table public.water_entries (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  logged_at      timestamptz not null default now(),
  amount_ml      integer not null check (amount_ml > 0),
  source         text not null default 'manual',
  healthkit_uuid text,
  unique (user_id, healthkit_uuid)
);

create table public.workouts (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  started_at     timestamptz not null default now(),
  activity_type  text not null,                       -- 'running', 'strength', ...
  duration_min   numeric(6, 1) not null check (duration_min >= 0),
  distance_km    numeric(7, 2),
  calories       numeric(7, 1),
  notes          text,
  source         text not null default 'manual',
  healthkit_uuid text,
  unique (user_id, healthkit_uuid)
);

create table public.insights (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  period_start date not null,
  period_end   date not null,
  content      text not null,
  model        text
);

create index on public.weight_entries (user_id, measured_at desc);
create index on public.food_entries   (user_id, eaten_at desc);
create index on public.sleep_entries  (user_id, sleep_date desc);
create index on public.water_entries  (user_id, logged_at desc);
create index on public.workouts       (user_id, started_at desc);
create index on public.insights       (user_id, created_at desc);

-- ───────────────────────── row level security ─────────────────────────
-- Owner: full access to own rows. Viewer (partner): read-only via `shares`.

alter table public.profiles enable row level security;
alter table public.shares   enable row level security;

create policy "read profiles you can see" on public.profiles for select using (public.can_read(id));
create policy "update own profile"        on public.profiles for update using (id = auth.uid());

create policy "see shares you're part of" on public.shares for select
  using (owner_id = auth.uid() or viewer_id = auth.uid());
create policy "owner removes shares" on public.shares for delete using (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['weight_entries', 'food_entries', 'sleep_entries', 'water_entries', 'workouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read own or shared" on public.%I for select using (public.can_read(user_id))', t);
    execute format('create policy "insert own" on public.%I for insert with check (user_id = auth.uid())', t);
    execute format('create policy "update own" on public.%I for update using (user_id = auth.uid())', t);
    execute format('create policy "delete own" on public.%I for delete using (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Insights are written by the Cloudflare Worker using the service role key (bypasses RLS).
alter table public.insights enable row level security;
create policy "read own or shared" on public.insights for select using (public.can_read(user_id));

grant select, update on public.profiles to authenticated;
grant select, delete on public.shares   to authenticated;
grant select         on public.insights to authenticated;
grant execute on function public.add_viewer(text), public.readable_owners(), public.can_read(uuid) to authenticated;

-- Live dashboard updates (the website subscribes to these; RLS still applies).
alter publication supabase_realtime add table
  public.weight_entries, public.food_entries, public.sleep_entries,
  public.water_entries, public.workouts, public.insights;
