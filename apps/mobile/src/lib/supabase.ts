import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const token = process.env.EXPO_PUBLIC_APP_TOKEN;

if (!url || !key || !token) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY / EXPO_PUBLIC_APP_TOKEN in apps/mobile/.env.local',
  );
}

/** Single-user client: no login, every request carries the app token that the database checks. */
export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-app-token': token } },
});

export const APP_TOKEN = token;

export type Settings = {
  display_name: string | null;
  units: 'imperial' | 'metric';
  calorie_goal: number | null;
  water_goal_ml: number | null;
  weight_goal_kg: number | null;
};

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export type FoodEntry = {
  id: number;
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
};

/** Start/end of the local day containing `d`, as ISO strings. */
export function dayRange(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** YYYY-MM-DD in local time. */
export function localDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
