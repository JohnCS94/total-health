-- Food now comes from Apple Health (Lose It writes it there). Imported entries are keyed by HealthKit UUID.
alter table public.food_entries add column if not exists healthkit_uuid text;
alter table public.food_entries add constraint food_entries_healthkit_uuid_key unique (healthkit_uuid);
