/**
 * Hevy → Supabase sync, run from the app when you tap "Sync Hevy" in Settings.
 *
 * Uses Hevy's incremental events feed (`/v1/workouts/events?since=…`), which returns workouts that were
 * created/updated and ids that were deleted since the last sync. The cursor is kept in `sync_state`.
 * The first sync (no cursor) backfills your entire Hevy history.
 */
import { supabase } from './supabase';

const API = 'https://api.hevyapp.com/v1';
const CURSOR_KEY = 'hevy_last_sync';
const PAGE_SIZE = 10; // Hevy's max

const HEVY_API_KEY = process.env.EXPO_PUBLIC_HEVY_API_KEY;
export const hevyConfigured = () => !!HEVY_API_KEY;

type HevySet = {
  index: number;
  type: string;
  weight_kg: number | null;
  reps: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  rpe: number | null;
};
type HevyExercise = {
  index: number;
  title: string;
  notes: string | null;
  exercise_template_id: string | null;
  superset_id: number | null;
  sets: HevySet[];
};
type HevyWorkout = {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  updated_at: string;
  exercises: HevyExercise[];
};
type HevyEvent = { type: 'updated'; workout: HevyWorkout } | { type: 'deleted'; id: string; deleted_at?: string };

export type HevySyncResult = { updated: number; deleted: number; firstSync: boolean };

async function hevyGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { 'api-key': HEVY_API_KEY!, accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new Error('Hevy rejected the API key (Hevy Pro is required for API access).');
  if (!res.ok) throw new Error(`Hevy API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

function toRows(w: HevyWorkout) {
  const working = w.exercises.flatMap((e) => e.sets.filter((s) => s.type !== 'warmup'));
  const volume = working.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  const durationMin = (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 60_000;

  const workout = {
    id: w.id,
    title: w.title,
    description: w.description,
    started_at: w.start_time,
    ended_at: w.end_time,
    duration_min: Math.round(durationMin * 10) / 10,
    volume_kg: Math.round(volume * 10) / 10,
    set_count: working.length,
    updated_at: w.updated_at,
  };

  const sets = w.exercises.flatMap((e) =>
    e.sets.map((s) => ({
      workout_id: w.id,
      exercise_index: e.index,
      exercise_title: e.title,
      exercise_template_id: e.exercise_template_id,
      superset_id: e.superset_id,
      exercise_notes: e.notes,
      set_index: s.index,
      set_type: s.type,
      weight_kg: s.weight_kg,
      reps: s.reps,
      distance_m: s.distance_meters,
      duration_s: s.duration_seconds,
      rpe: s.rpe,
    })),
  );

  return { workout, sets };
}

export async function syncHevy(): Promise<HevySyncResult> {
  if (!HEVY_API_KEY) throw new Error('Set EXPO_PUBLIC_HEVY_API_KEY in apps/mobile/.env.local');

  const { data: cursorRow, error: cursorErr } = await supabase.from('sync_state').select('value').eq('key', CURSOR_KEY).maybeSingle();
  if (cursorErr) throw new Error(cursorErr.message);
  const since = cursorRow?.value ?? '1970-01-01T00:00:00Z';
  const startedAt = new Date().toISOString();

  // Collect all events first; later events for the same workout win.
  const latest = new Map<string, HevyEvent>();
  for (let page = 1, pageCount = 1; page <= pageCount; page++) {
    const res = await hevyGet<{ page: number; page_count: number; events: HevyEvent[] }>(
      `/workouts/events?page=${page}&pageSize=${PAGE_SIZE}&since=${encodeURIComponent(since)}`,
    );
    pageCount = res.page_count ?? 1;
    for (const ev of res.events ?? []) latest.set(ev.type === 'updated' ? ev.workout.id : ev.id, ev);
  }

  const updated = [...latest.values()].flatMap((e) => (e.type === 'updated' ? [e.workout] : []));
  const deletedIds = [...latest.values()].flatMap((e) => (e.type === 'deleted' ? [e.id] : []));

  if (deletedIds.length) {
    const { error } = await supabase.from('hevy_workouts').delete().in('id', deletedIds);
    if (error) throw new Error(error.message);
  }

  for (const w of updated) {
    const { workout, sets } = toRows(w);
    const up = await supabase.from('hevy_workouts').upsert(workout, { onConflict: 'id' });
    if (up.error) throw new Error(up.error.message);
    // Replace the workout's sets wholesale (edits can add/remove/reorder sets).
    const del = await supabase.from('hevy_sets').delete().eq('workout_id', w.id);
    if (del.error) throw new Error(del.error.message);
    if (sets.length) {
      const ins = await supabase.from('hevy_sets').insert(sets);
      if (ins.error) throw new Error(ins.error.message);
    }
  }

  // Only advance the cursor once everything was written.
  const { error } = await supabase
    .from('sync_state')
    .upsert({ key: CURSOR_KEY, value: startedAt, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);

  return { updated: updated.length, deleted: deletedIds.length, firstSync: !cursorRow };
}

/** When Hevy was last synced (ISO string), or null if never. */
export async function lastHevySync(): Promise<string | null> {
  const { data } = await supabase.from('sync_state').select('updated_at').eq('key', CURSOR_KEY).maybeSingle();
  return data?.updated_at ?? null;
}
