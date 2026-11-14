/**
 * Food import from Apple Health (written there by Lose It, or any other food app).
 *
 * Food apps usually save each logged food as an HKCorrelation of type Food, with the food's name in
 * the `HKFoodType` metadata and its nutrients (energy, protein, carbs, fat, …) as child samples.
 * Each correlation becomes one food entry. Nutrient samples that aren't part of a correlation are
 * grouped by source + timestamp into an entry each.
 *
 * Imported entries are keyed by their HealthKit UUID, so re-syncing updates them, and foods deleted in
 * Lose It are removed here on the next sync. On days that have imported food, entries made the old way
 * (manually in this app) are removed so the same meal isn't counted twice.
 */
import { queryCorrelationSamples, queryQuantitySamples } from '@kingstinct/react-native-healthkit';

import { localDate, supabase, type Meal } from './supabase';

export const NUTRITION_READ = [
  'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  'HKQuantityTypeIdentifierDietaryProtein',
  'HKQuantityTypeIdentifierDietaryCarbohydrates',
  'HKQuantityTypeIdentifierDietaryFatTotal',
] as const;

type Nutrient = 'calories' | 'protein' | 'carbs' | 'fat';
const NUTRIENT_OF: Record<string, Nutrient> = {
  HKQuantityTypeIdentifierDietaryEnergyConsumed: 'calories',
  HKQuantityTypeIdentifierDietaryProtein: 'protein',
  HKQuantityTypeIdentifierDietaryCarbohydrates: 'carbs',
  HKQuantityTypeIdentifierDietaryFatTotal: 'fat',
};

type Sample = {
  uuid: string;
  quantityType?: string;
  quantity?: number;
  unit?: string;
  startDate: Date;
  metadata?: Record<string, unknown>;
  sourceRevision?: { source?: { bundleIdentifier?: string; name?: string } };
};

export type FoodRow = {
  healthkit_uuid: string;
  eaten_at: string;
  meal: Meal;
  name: string;
  brand: string | null;
  serving_desc: string | null;
  servings: number;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  source: 'healthkit';
};

/** Convert energy to kcal (correlation children come back in the user's preferred unit). */
function kcal(q: number, unit?: string) {
  if (!unit) return q;
  const u = unit.toLowerCase();
  if (u === 'kj') return q / 4.184;
  if (u === 'j') return q / 4184;
  return q; // kcal / Cal
}
function grams(q: number, unit?: string) {
  if (!unit) return q;
  const u = unit.toLowerCase();
  if (u === 'mg') return q / 1000;
  if (u === 'kg') return q * 1000;
  if (u === 'oz') return q * 28.3495;
  return q;
}

function mealFor(date: Date, metadata?: Record<string, unknown>): Meal {
  // Some apps tag the meal in metadata; otherwise infer from time of day.
  const tagged = Object.entries(metadata ?? {}).find(([k]) => /meal/i.test(k))?.[1];
  if (typeof tagged === 'string') {
    const m = tagged.toLowerCase();
    if (m.includes('breakfast')) return 'breakfast';
    if (m.includes('lunch')) return 'lunch';
    if (m.includes('dinner') || m.includes('supper')) return 'dinner';
    if (m.includes('snack')) return 'snack';
  }
  const h = date.getHours();
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

function foodName(metadata?: Record<string, unknown>) {
  const n = metadata?.HKFoodType;
  return typeof n === 'string' && n.trim() ? n.trim() : 'Food';
}

function totals(samples: Sample[]) {
  const t: Record<Nutrient, number | null> = { calories: null, protein: null, carbs: null, fat: null };
  for (const s of samples) {
    const key = s.quantityType ? NUTRIENT_OF[s.quantityType] : undefined;
    if (!key || s.quantity == null) continue;
    const v = key === 'calories' ? kcal(s.quantity, s.unit) : grams(s.quantity, s.unit);
    t[key] = (t[key] ?? 0) + v;
  }
  return t;
}

const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

/** Read food from Health for [startDate, now] and build food_entries rows. */
export async function readFoodFromHealth(startDate: Date): Promise<{ rows: FoodRow[]; sampleCount: number }> {
  const filter = { date: { startDate } };
  const [correlations, ...byType] = await Promise.all([
    queryCorrelationSamples('HKCorrelationTypeIdentifierFood', { limit: 0, filter }).catch(() => []),
    ...NUTRITION_READ.map((t) =>
      queryQuantitySamples(t, { limit: 0, filter, unit: t === 'HKQuantityTypeIdentifierDietaryEnergyConsumed' ? 'kcal' : 'g' }),
    ),
  ]);

  const rows: FoodRow[] = [];
  const used = new Set<string>();

  for (const c of correlations as unknown as (Sample & { objects: Sample[] })[]) {
    const t = totals(c.objects);
    c.objects.forEach((o) => used.add(o.uuid));
    if (t.calories == null && t.protein == null && t.carbs == null && t.fat == null) continue;
    rows.push({
      healthkit_uuid: c.uuid,
      eaten_at: c.startDate.toISOString(),
      meal: mealFor(c.startDate, c.metadata),
      name: foodName(c.metadata),
      brand: null,
      serving_desc: null,
      servings: 1,
      calories: Math.round(t.calories ?? 0),
      protein_g: r1(t.protein),
      carbs_g: r1(t.carbs),
      fat_g: r1(t.fat),
      source: 'healthkit',
    });
  }

  // Loose nutrient samples (not inside a Food correlation): one entry per source + timestamp.
  const loose = new Map<string, Sample[]>();
  for (const list of byType as unknown as Sample[][]) {
    for (const s of list) {
      if (used.has(s.uuid)) continue;
      const key = `${s.sourceRevision?.source?.bundleIdentifier ?? ''}|${s.startDate.getTime()}`;
      loose.set(key, [...(loose.get(key) ?? []), s]);
    }
  }
  for (const group of loose.values()) {
    const t = totals(group);
    const anchor = group.find((s) => s.quantityType === 'HKQuantityTypeIdentifierDietaryEnergyConsumed') ?? group[0];
    rows.push({
      healthkit_uuid: anchor.uuid,
      eaten_at: anchor.startDate.toISOString(),
      meal: mealFor(anchor.startDate, anchor.metadata),
      name: foodName(anchor.metadata),
      brand: null,
      serving_desc: null,
      servings: 1,
      calories: Math.round(t.calories ?? 0),
      protein_g: r1(t.protein),
      carbs_g: r1(t.carbs),
      fat_g: r1(t.fat),
      source: 'healthkit',
    });
  }

  const sampleCount = (byType as unknown as Sample[][]).reduce((a, l) => a + l.length, 0) + correlations.length;
  return { rows, sampleCount };
}

const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Write imported food for [startDate, now]: upsert current, delete removed, replace manual entries on covered days. */
export async function saveFood(rows: FoodRow[], startDate: Date) {
  const since = startDate.toISOString();

  for (const part of chunks(rows)) {
    const { error } = await supabase.from('food_entries').upsert(part, { onConflict: 'healthkit_uuid' });
    if (error) throw new Error(error.message);
  }

  const { data: existing, error } = await supabase
    .from('food_entries')
    .select('id, healthkit_uuid, source, eaten_at')
    .gte('eaten_at', since)
    .limit(10000);
  if (error) throw new Error(error.message);

  const current = new Set(rows.map((r) => r.healthkit_uuid));
  const coveredDays = new Set(rows.map((r) => localDate(new Date(r.eaten_at))));
  const toDelete = (existing ?? [])
    .filter((e) =>
      e.source === 'healthkit'
        ? !current.has(e.healthkit_uuid) // deleted in Lose It
        : coveredDays.has(localDate(new Date(e.eaten_at))), // old manual entry on a day Lose It covers
    )
    .map((e) => e.id as number);

  for (const part of chunks(toDelete)) {
    const del = await supabase.from('food_entries').delete().in('id', part);
    if (del.error) throw new Error(del.error.message);
  }
  return { removed: toDelete.length };
}
