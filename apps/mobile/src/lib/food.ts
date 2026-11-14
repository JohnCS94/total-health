/**
 * Food lookup:
 *  - USDA FoodData Central for text search (generic + branded foods)
 *  - Open Food Facts for barcode lookup (packaged foods)
 *
 * Both are normalized to nutrients per 100 g plus an optional default serving,
 * so the UI can scale by grams or by servings.
 */

export type FoodResult = {
  source: 'usda' | 'openfoodfacts';
  externalId: string;
  name: string;
  brand?: string;
  per100g: { calories: number; protein: number; carbs: number; fat: number };
  serving?: { grams: number; label: string };
};

const USDA_KEY = process.env.EXPO_PUBLIC_USDA_API_KEY || 'DEMO_KEY';

// USDA nutrient ids
const ENERGY_KCAL = 1008;
const ENERGY_ATWATER = [2047, 2048]; // Foundation foods sometimes only report these
const PROTEIN = 1003;
const FAT = 1004;
const CARBS = 1005;

type UsdaNutrient = { nutrientId: number; value: number; unitName: string };
type UsdaFood = {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients: UsdaNutrient[];
};

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

export async function searchFoods(query: string, signal?: AbortSignal): Promise<FoodResult[]> {
  const params = new URLSearchParams({
    api_key: USDA_KEY,
    query,
    pageSize: '30',
  });
  // Prefer generic foods first, then branded.
  params.append('dataType', 'Foundation');
  params.append('dataType', 'SR Legacy');
  params.append('dataType', 'Survey (FNDDS)');
  params.append('dataType', 'Branded');

  const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, { signal });
  if (!res.ok) throw new Error(`USDA search failed (${res.status})`);
  const json = (await res.json()) as { foods: UsdaFood[] };

  return json.foods
    .map((f): FoodResult | null => {
      const get = (id: number) => f.foodNutrients.find((n) => n.nutrientId === id)?.value;
      const kcal =
        get(ENERGY_KCAL) ?? ENERGY_ATWATER.map(get).find((v) => v !== undefined);
      if (kcal === undefined) return null;

      const grams =
        f.servingSize && f.servingSizeUnit && /^(g|grm|ml|mlt)$/i.test(f.servingSizeUnit)
          ? f.servingSize
          : undefined;

      return {
        source: 'usda',
        externalId: String(f.fdcId),
        name: titleCase(f.description),
        brand: f.brandName || f.brandOwner || undefined,
        per100g: { calories: kcal, protein: get(PROTEIN) ?? 0, carbs: get(CARBS) ?? 0, fat: get(FAT) ?? 0 },
        serving: grams
          ? { grams, label: f.householdServingFullText ? `${f.householdServingFullText} (${grams} g)` : `${grams} g` }
          : undefined,
      };
    })
    .filter((f): f is FoodResult => f !== null);
}

export async function lookupBarcode(barcode: string): Promise<FoodResult | null> {
  const fields = 'product_name,brands,nutriments,serving_size,serving_quantity';
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`,
    { headers: { 'User-Agent': 'PersonalHealthApp/1.0' } },
  );
  if (!res.ok) return null;
  const json = await res.json();
  if (json.status !== 1 || !json.product) return null;

  const p = json.product;
  const n = p.nutriments ?? {};
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : undefined);
  if (kcal === undefined) return null;

  const servingGrams = Number(p.serving_quantity);
  return {
    source: 'openfoodfacts',
    externalId: barcode,
    name: p.product_name || 'Unknown product',
    brand: p.brands?.split(',')[0]?.trim(),
    per100g: {
      calories: kcal,
      protein: n.proteins_100g ?? 0,
      carbs: n.carbohydrates_100g ?? 0,
      fat: n.fat_100g ?? 0,
    },
    serving: servingGrams > 0 ? { grams: servingGrams, label: p.serving_size || `${servingGrams} g` } : undefined,
  };
}

/** Totals for `grams` of a food. */
export function nutrientsFor(food: FoodResult, grams: number) {
  const f = grams / 100;
  return {
    calories: Math.round(food.per100g.calories * f),
    protein: Math.round(food.per100g.protein * f * 10) / 10,
    carbs: Math.round(food.per100g.carbs * f * 10) / 10,
    fat: Math.round(food.per100g.fat * f * 10) / 10,
  };
}
