/**
 * Apple Health integration.
 *
 * Read-only: imports food (Lose It), weight, sleep, water and workouts from HealthKit into Supabase.
 * Rows are keyed by their HealthKit UUID so re-syncing never creates duplicates.
 */
import {
  WorkoutActivityType,
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  queryWorkoutSamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Platform } from 'react-native';

import { NUTRITION_READ, readFoodFromHealth, saveFood } from './nutrition';
import { buildSessions, scoreNight } from './sleepScore';
import { localDate, supabase } from './supabase';

const READ = [
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierDietaryWater',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKWorkoutTypeIdentifier',
  // Needed to read a workout's distance/calories when the app that recorded it (e.g. Strava)
  // attaches them as statistics instead of filling in the workout's totals.
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierDistanceCycling',
  'HKQuantityTypeIdentifierDistanceSwimming',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  // Food logged in Lose It (calories + macros). See nutrition.ts.
  ...NUTRITION_READ,
] as const;

export function healthAvailable() {
  return Platform.OS === 'ios' && isHealthDataAvailable();
}

/** Must be called before any query, or HealthKit will crash the app. Safe to call repeatedly. */
export async function ensureHealthAuthorization() {
  if (!healthAvailable()) return false;
  return requestAuthorization({ toRead: READ });
}

// ───────────────────────── import ─────────────────────────

export type SyncResult = {
  weight: number;
  water: number;
  sleepNights: number;
  workouts: number;
  food: number;
  duplicatesRemoved: number;
  /** Types that returned nothing from Health — usually means that permission is off. */
  empty: string[];
};

/** Friendlier names for the HealthKit activity types we care about; everything else uses the enum name. */
const ACTIVITY_ALIASES: Partial<Record<string, string>> = {
  traditionalStrengthTraining: 'strength',
  functionalStrengthTraining: 'strength',
  highIntensityIntervalTraining: 'hiit',
};

export function activityName(type: number) {
  const raw = WorkoutActivityType[type] ?? 'other';
  return ACTIVITY_ALIASES[raw] ?? raw;
}

const hours = (ms: number) => Math.round((ms / 3_600_000) * 100) / 100;

function toKm(q?: { quantity: number; unit: string }) {
  if (!q) return null;
  switch (q.unit) {
    case 'm':
    case 'meter':
    case 'meters':
      return q.quantity / 1000;
    case 'km':
      return q.quantity;
    case 'mi':
    case 'mile':
    case 'miles':
      return q.quantity * 1.609344;
    case 'yd':
    case 'yard':
    case 'yards':
      return q.quantity * 0.0009144;
    default:
      return null;
  }
}

function toKcal(q?: { quantity: number; unit: string }) {
  if (!q) return null;
  if (q.unit === 'kJ') return q.quantity / 4.184;
  return q.quantity; // 'kcal' / 'Cal'
}

const DISTANCE_TYPES = [
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierDistanceCycling',
  'HKQuantityTypeIdentifierDistanceSwimming',
] as const;

async function workoutStatKm(w: { getStatistic: (t: (typeof DISTANCE_TYPES)[number], unit?: string) => Promise<{ sumQuantity?: { quantity: number } } | undefined> }) {
  for (const type of DISTANCE_TYPES) {
    const stat = await w.getStatistic(type, 'm').catch(() => undefined);
    if (stat?.sumQuantity && stat.sumQuantity.quantity > 0) return stat.sumQuantity.quantity / 1000;
  }
  return null;
}

export async function syncFromHealth(days = 30): Promise<SyncResult> {
  if (!(await ensureHealthAuthorization())) throw new Error('Apple Health is not available on this device.');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  const filter = { date: { startDate } };
  // Sleep is read 14 extra days back so bedtime consistency has a baseline (13 previous nights).
  const sleepStart = new Date(startDate);
  sleepStart.setDate(sleepStart.getDate() - 14);

  const [weights, water, sleep, workouts, food] = await Promise.all([
    queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', { limit: 0, unit: 'kg', filter }),
    queryQuantitySamples('HKQuantityTypeIdentifierDietaryWater', { limit: 0, unit: 'mL', filter }),
    queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { limit: 0, filter: { date: { startDate: sleepStart } } }),
    queryWorkoutSamples({ limit: 0, filter }),
    readFoodFromHealth(startDate),
  ]);

  // Weight & water: insert new samples, leave existing rows (incl. ones we wrote) untouched.
  const weightRows = weights.map((s) => ({
    measured_at: s.startDate.toISOString(),
    weight_kg: Math.round(s.quantity * 100) / 100,
    source: 'healthkit',
    healthkit_uuid: s.uuid,
  }));
  const waterRows = water.map((s) => ({
    logged_at: s.startDate.toISOString(),
    amount_ml: Math.round(s.quantity),
    source: 'healthkit',
    healthkit_uuid: s.uuid,
  }));

  // Sleep: cluster samples into sessions, keep the main one per night, and score it (see sleepScore.ts).
  const sessions = buildSessions(
    sleep.map((x) => ({
      start: x.startDate,
      end: x.endDate,
      value: x.value as number,
      source: x.sourceRevision?.source?.bundleIdentifier ?? 'unknown',
    })),
  );
  const firstDate = localDate(startDate);
  const sleepRows = sessions
    .map((n, i) => ({ n, sc: scoreNight(n, sessions.slice(Math.max(0, i - 13), i).map((p) => p.onset)) }))
    .filter(({ n }) => n.date >= firstDate)
    .map(({ n, sc }) => ({
      sleep_date: n.date,
      hours: hours(n.asleepMs),
      deep_hours: n.deepMs ? hours(n.deepMs) : null,
      rem_hours: n.remMs ? hours(n.remMs) : null,
      bedtime: n.onset.toISOString(),
      wake_time: n.wake.toISOString(),
      awake_min: Math.round(n.awakeMs / 6_000) / 10,
      wake_count: n.wakeCount,
      score: sc.total,
      score_duration: sc.duration,
      score_consistency: sc.consistency,
      score_interruptions: sc.interruptions,
      source: 'healthkit',
    }));

  // Hevy workouts come in directly from the Hevy API (see src/lib/hevy.ts), so skip the copies
  // Hevy writes to Apple Health to avoid counting the same session twice.
  const fromHevy = (w: (typeof workouts)[number]) =>
    /hevy/i.test(`${w.sourceRevision?.source?.bundleIdentifier ?? ''} ${w.sourceRevision?.source?.name ?? ''}`);
  const dropUuids: string[] = [];
  const keep = workouts.filter((w) => {
    if (!fromHevy(w)) return true;
    dropUuids.push(w.uuid);
    w.dispose();
    return false;
  });

  const allWorkoutRows = await Promise.all(keep.map(async (w) => {
    const j = w.toJSON();
    const durationSec = j.duration.unit === 'min' ? j.duration.quantity * 60 : j.duration.quantity;
    let km = toKm(j.totalDistance);
    let kcal = toKcal(j.totalEnergyBurned);
    // Fallback: sum of the distance / energy samples attached to this workout.
    if (km === null) km = await workoutStatKm(w);
    if (kcal === null) {
      const e = await w.getStatistic('HKQuantityTypeIdentifierActiveEnergyBurned', 'kcal').catch(() => undefined);
      kcal = e?.sumQuantity ? e.sumQuantity.quantity : null;
    }
    w.dispose();
    return {
      started_at: j.startDate.toISOString(),
      activity_type: activityName(j.workoutActivityType),
      duration_min: Math.round((durationSec / 60) * 10) / 10,
      distance_km: km !== null ? Math.round(km * 100) / 100 : null,
      calories: kcal !== null ? Math.round(kcal) : null,
      source: 'healthkit',
      healthkit_uuid: j.uuid,
    };
  }));

  // The same session is often saved by more than one app (e.g. Strava and the Watch's Workout app).
  // Treat same-activity workouts starting within 2 minutes as one, keeping the most complete record.
  // The pick is deterministic so re-syncs always keep the same copy.
  const ranked = [...allWorkoutRows].sort(
    (a, b) =>
      Number(b.distance_km != null) - Number(a.distance_km != null) ||
      Number(b.calories != null) - Number(a.calories != null) ||
      b.duration_min - a.duration_min ||
      a.healthkit_uuid.localeCompare(b.healthkit_uuid),
  );
  const workoutRows: typeof allWorkoutRows = [];
  for (const r of ranked) {
    const t = new Date(r.started_at).getTime();
    const dup = workoutRows.some(
      (k) => k.activity_type === r.activity_type && Math.abs(new Date(k.started_at).getTime() - t) < 2 * 60_000,
    );
    if (dup) dropUuids.push(r.healthkit_uuid);
    else workoutRows.push(r);
  }

  const ignore = { onConflict: 'healthkit_uuid', ignoreDuplicates: true } as const;
  const results = await Promise.all([
    weightRows.length ? supabase.from('weight_entries').upsert(weightRows, ignore) : null,
    waterRows.length ? supabase.from('water_entries').upsert(waterRows, ignore) : null,
    sleepRows.length ? supabase.from('sleep_entries').upsert(sleepRows, { onConflict: 'sleep_date' }) : null,
    // Workouts update on re-sync, so fixes to how we read them apply to already-imported runs.
    workoutRows.length ? supabase.from('workouts').upsert(workoutRows, { onConflict: 'healthkit_uuid' }) : null,
    // Remove duplicate / Hevy copies that earlier syncs imported.
    dropUuids.length ? supabase.from('workouts').delete().in('healthkit_uuid', dropUuids).select('id') : null,
  ]);
  const err = results.find((r) => r?.error)?.error;
  if (err) throw new Error(err.message);

  const removed = results[4]?.data?.length ?? 0;
  // Nothing at all from Health usually means the permission is off, not that you deleted everything,
  // so only reconcile (which can delete) when food data actually came back.
  if (food.sampleCount) await saveFood(food.rows, startDate);
  const empty = [
    weights.length ? null : 'Weight',
    water.length ? null : 'Water',
    sleep.length ? null : 'Sleep',
    workouts.length ? null : 'Workouts',
    food.sampleCount ? null : 'Food',
  ].filter((x): x is string => x !== null);

  return {
    weight: weightRows.length,
    water: waterRows.length,
    sleepNights: sleepRows.length,
    workouts: workoutRows.length,
    food: food.rows.length,
    duplicatesRemoved: removed,
    empty,
  };
}
