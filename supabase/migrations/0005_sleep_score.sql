-- Calculated Sleep Score (replaces manually entered scores).
-- 100 = duration (0–50) + bedtime consistency (0–30) + interruptions (0–20). See apps/mobile/src/lib/sleepScore.ts.

alter table public.sleep_entries
  add column if not exists bedtime             timestamptz,   -- fell asleep
  add column if not exists wake_time           timestamptz,   -- final wake-up
  add column if not exists awake_min           numeric(5, 1), -- awake time after falling asleep
  add column if not exists wake_count          integer,       -- awakenings ≥ 2 min
  add column if not exists score_duration      numeric(4, 1),
  add column if not exists score_consistency   numeric(4, 1),
  add column if not exists score_interruptions numeric(4, 1);

-- Old manual scores aren't comparable with the calculated ones; the next Apple Health sync fills these in.
update public.sleep_entries set score = null where score_duration is null;
