-- Convert to a single-user app: no accounts, no sharing.
--
-- Access is controlled by a secret APP TOKEN (generated below, stored in a private schema the API
-- can't read). The iPhone app, the website's server and the Cloudflare Worker send it as the
-- `x-app-token` header. Requests without it (e.g. someone who only has the publishable key) see nothing.
--
-- Safe to run on a database that already has 0001 applied; existing entries are kept.
-- After running, copy the token printed at the bottom.

begin;

-- ───────── 1. drop the multi-user policies ─────────
do $$
declare t text;
begin
  foreach t in array array['weight_entries', 'food_entries', 'sleep_entries', 'water_entries', 'workouts', 'insights'] loop
    execute format('drop policy if exists "read own or shared" on public.%I', t);
    execute format('drop policy if exists "insert own" on public.%I', t);
    execute format('drop policy if exists "update own" on public.%I', t);
    execute format('drop policy if exists "delete own" on public.%I', t);
  end loop;
end $$;

-- ───────── 2. settings (replaces profiles) ─────────
create table public.settings (
  id             integer primary key default 1 check (id = 1),   -- exactly one row
  display_name   text,
  units          text not null default 'imperial' check (units in ('imperial', 'metric')),
  calorie_goal   integer default 2200,
  water_goal_ml  integer default 2500,
  weight_goal_kg numeric(5, 2)
);

-- Carry over goals from the profile that owns the most entries (if any).
insert into public.settings (id, display_name, units, calorie_goal, water_goal_ml, weight_goal_kg)
select 1, p.display_name, p.units, p.calorie_goal, p.water_goal_ml, p.weight_goal_kg
from public.profiles p
left join (
  select user_id, count(*) n from (
    select user_id from public.food_entries union all
    select user_id from public.weight_entries union all
    select user_id from public.workouts
  ) x group by user_id
) c on c.user_id = p.id
order by c.n desc nulls last, p.created_at
limit 1;
insert into public.settings (id) values (1) on conflict do nothing;

-- ───────── 3. remove accounts / sharing ─────────
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.shares;
drop table if exists public.profiles;
drop function if exists public.handle_new_user();
drop function if exists public.add_viewer(text);
drop function if exists public.readable_owners();
drop function if exists public.can_read(uuid);

-- user_id columns go away (cascade drops the old (user_id, …) unique constraints and indexes).
alter table public.weight_entries drop column user_id cascade;
alter table public.food_entries   drop column user_id cascade;
alter table public.sleep_entries  drop column user_id cascade;
alter table public.water_entries  drop column user_id cascade;
alter table public.workouts       drop column user_id cascade;
alter table public.insights       drop column user_id cascade;

alter table public.weight_entries add unique (healthkit_uuid);
alter table public.water_entries  add unique (healthkit_uuid);
alter table public.workouts       add unique (healthkit_uuid);
alter table public.sleep_entries  add unique (sleep_date);

create index on public.weight_entries (measured_at desc);
create index on public.food_entries   (eaten_at desc);
create index on public.water_entries  (logged_at desc);
create index on public.workouts       (started_at desc);
create index on public.insights       (created_at desc);

-- ───────── 4. app token ─────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_token (
  token text not null
);
insert into private.app_token (token)
values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

-- True when the request carries the correct x-app-token header.
create function public.has_app_token() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.app_token
    where token = coalesce(current_setting('request.headers', true)::json ->> 'x-app-token', '')
  );
$$;
grant execute on function public.has_app_token() to anon, authenticated;

-- ───────── 5. policies: token holders get full access, everyone else nothing ─────────
alter table public.settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['weight_entries', 'food_entries', 'sleep_entries', 'water_entries', 'workouts', 'insights', 'settings'] loop
    execute format('create policy "app token" on public.%I for all to anon, authenticated using ((select public.has_app_token())) with check ((select public.has_app_token()))', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

commit;

-- ───────── 6. your token ─────────
-- Copy this value into:
--   apps/mobile/.env.local      EXPO_PUBLIC_APP_TOKEN=...
--   Vercel env vars             APP_TOKEN=...
--   Cloudflare                  npx wrangler secret put APP_TOKEN
-- (You can view it again any time with: select token from private.app_token;)
select token as "YOUR APP TOKEN — copy this" from private.app_token;
