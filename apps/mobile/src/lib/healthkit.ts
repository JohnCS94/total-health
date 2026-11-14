/**
 * Apple Health integration.
 *
 * Reads weight, sleep, water and workouts from HealthKit and upserts them into Supabase.
 * Weight and water logged manually in the app are also written back to Health; the
 * returned HealthKit UUID is stored on the row so the next sync doesn't import a duplicate.
 */
import {
  CategoryValueSleepAnalysis,
  WorkoutActivityType,
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  queryWorkoutSamples,
  requestAuthorization,
  saveQuantitySample,
} from '@kingstinct/react-native-healthkit';
import { Platform } from 'react-native';

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
] as const;

const WRITE = ['HKQuantityTypeIdentifierBodyMass', 'HKQuantityTypeIdentifierDietaryWater'] as const;

export function healthAvailable() {
  return Platform.OS === 'ios' && isHealthDataAvailable();
}

/** Must be called before any query, or HealthKit will crash the app. Safe to call repeatedly. */
export async function ensureHealthAuthorization() {
  if (!healthAvailable()) return false;
  return requestAuthorization({ toRead: READ, toShare: WRITE });
}

// ───────────────────────── write-back ─────────────────────────

export async function saveWeightToHealth(kg: number, at: Date): Promise<string | undefined> {
  if (!(await ensureHealthAuthorization())) return undefined;
  const s = await saveQuantitySample('HKQuantityTypeIdentifierBodyMass', 'kg', kg, at, at);
  return s?.uuid;
}

export async function saveWaterToHealth(ml: number, at: Date): Promise<string | undefined> {
  if (!(await ensureHealthAuthorization())) return undefined;
  const s = await saveQuantitySample('HKQuantityTypeIdentifierDietaryWater', 'mL', ml, at, at);
  return s?.uuid;
}

// ───────────────────────── import ─────────────────────────

export type SyncResult = { weight: number; water: number; sleepNights: number; workouts: number };

const ASLEEP = new Set<number>([
  CategoryValueSleepAnalysis.asleepUnspecified,
  CategoryValueSleepAnalysis.asleepCore,
  CategoryValueSleepAnalysis.asleepDeep,
  CategoryValueSleepAnalysis.asleepREM,
]);

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

  const [weights, water, sleep, workouts] = await Promise.all([
    queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', { limit: 0, unit: 'kg', filter }),
    queryQuantitySamples('HKQuantityTypeIdentifierDietaryWater', { limit: 0, unit: 'mL', filter }),
    queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { limit: 0, filter }),
    queryWorkoutSamples({ limit: 0, filter }),
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

  // Sleep: group by wake-up date. Several sources (Watch, iPhone, Oura, …) can overlap, so per
  // night we keep only the source that recorded the most sleep instead of summing them all.
  type Night = { asleep: number; inBed: number; deep: number; rem: number };
  const nights = new Map<string, Map<string, Night>>();
  for (const s of sleep) {
    const date = localDate(s.endDate);
    const src = s.sourceRevision?.source?.bundleIdentifier ?? 'unknown';
    const bySource = nights.get(date) ?? new Map<string, Night>();
    const n = bySource.get(src) ?? { asleep: 0, inBed: 0, deep: 0, rem: 0 };
    const ms = s.endDate.getTime() - s.startDate.getTime();
    const v = s.value as number;
    if (ASLEEP.has(v)) n.asleep += ms;
    if (v === CategoryValueSleepAnalysis.inBed) n.inBed += ms;
    if (v === CategoryValueSleepAnalysis.asleepDeep) n.deep += ms;
    if (v === CategoryValueSleepAnalysis.asleepREM) n.rem += ms;
    bySource.set(src, n);
    nights.set(date, bySource);
  }
  const sleepRows = [...nights.entries()].map(([date, bySource]) => {
    const best = [...bySource.values()].sort((a, b) => b.asleep - a.asleep || b.inBed - a.inBed)[0];
    return {
        sleep_date: date,
      hours: hours(best.asleep || best.inBed),
      deep_hours: best.deep ? hours(best.deep) : null,
      rem_hours: best.rem ? hours(best.rem) : null,
      source: 'healthkit',
      // `score` intentionally omitted so a manually entered sleep score is preserved.
    };
  });

  // Hevy workouts come in directly from the Hevy API (see src/lib/hevy.ts), so skip the copies
  // Hevy writes to Apple Health to avoid counting the same session twice.
  const fromHevy = (w: (typeof workouts)[number]) =>
    /hevy/i.test(`${w.sourceRevision?.source?.bundleIdentifier ?? ''} ${w.sourceRevision?.source?.name ?? ''}`);
  const keep = workouts.filter((w) => {
    if (!fromHevy(w)) return true;
    w.dispose();
    return false;
  });

  const workoutRows = await Promise.all(keep.map(async (w) => {
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

  const ignore = { onConflict: 'healthkit_uuid', ignoreDuplicates: true } as const;
  const results = await Promise.all([
    weightRows.length ? supabase.from('weight_entries').upsert(weightRows, ignore) : null,
    waterRows.length ? supabase.from('water_entries').upsert(waterRows, ignore) : null,
    sleepRows.length ? supabase.from('sleep_entries').upsert(sleepRows, { onConflict: 'sleep_date' }) : null,
    // Workouts update on re-sync, so fixes to how we read them apply to already-imported runs.
    workoutRows.length ? supabase.from('workouts').upsert(workoutRows, { onConflict: 'healthkit_uuid' }) : null,
  ]);
  const err = results.find((r) => r?.error)?.error;
  if (err) throw new Error(err.message);

  return {
    weight: weightRows.length,
    water: waterRows.length,
    sleepNights: sleepRows.length,
    workouts: workoutRows.length,
  };
}
