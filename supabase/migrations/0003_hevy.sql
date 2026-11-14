-- Hevy strength training, synced by the Cloudflare Worker from the Hevy API.
-- Kept separate from `workouts` (Apple Health / manual). The website's Training volume
-- chart combines both, counting Hevy session time as "strength".

begin;

create table public.hevy_workouts (
  id           text primary key,             -- Hevy workout id
  title        text,
  description  text,
  started_at   timestamptz not null,
  ended_at     timestamptz,
  duration_min numeric(6, 1),
  volume_kg    numeric(10, 1),               -- Σ weight × reps over working sets (warm-ups excluded)
  set_count    integer,                      -- working sets
  updated_at   timestamptz                   -- Hevy's last-modified time
);

create table public.hevy_sets (
  id                   bigint generated always as identity primary key,
  workout_id           text not null references public.hevy_workouts (id) on delete cascade,
  exercise_index       integer not null,
  exercise_title       text not null,
  exercise_template_id text,
  superset_id          integer,
  exercise_notes       text,
  set_index            integer not null,
  set_type             text,                 -- normal | warmup | dropset | failure
  weight_kg            numeric(7, 2),
  reps                 integer,
  distance_m           numeric(9, 1),
  duration_s           numeric(8, 1),
  rpe                  numeric(3, 1)
);

-- Small key/value store for sync cursors (e.g. last Hevy sync time).
create table public.sync_state (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

create index on public.hevy_workouts (started_at desc);
create index on public.hevy_sets (workout_id);
create index on public.hevy_sets (exercise_title);

do $$
declare t text;
begin
  foreach t in array array['hevy_workouts', 'hevy_sets', 'sync_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "app token" on public.%I for all to anon, authenticated using ((select public.has_app_token())) with check ((select public.has_app_token()))', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;


commit;
