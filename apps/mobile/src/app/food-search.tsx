import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';

import { Body, Button, Card, Chip, Input, Label, Row, Title, accent, useTheme } from '@/components/ui';
import { lookupBarcode, nutrientsFor, searchFoods, type FoodResult } from '@/lib/food';
import { onBarcode } from '@/lib/scanBus';
import { MEALS, supabase, type Meal } from '@/lib/supabase';

type FoodRow = {
  name: string;
  brand?: string;
  serving_desc?: string;
  servings: number;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  source: string;
  external_id?: string;
};

/** Guess the meal from the time of day. */
function defaultMeal(): Meal {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

/** Build an eaten_at timestamp: now if `date` is today, otherwise noon on that date. */
function eatenAt(date?: string) {
  if (!date) return new Date().toISOString();
  const [y, m, d] = date.split('-').map(Number);
  const now = new Date();
  const sameDay = now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === d;
  return (sameDay ? now : new Date(y, m - 1, d, 12)).toISOString();
}

export default function FoodSearch() {
  const t = useTheme();
  const params = useLocalSearchParams<{ meal?: Meal; date?: string }>();
  const [meal, setMeal] = useState<Meal>(params.meal ?? defaultMeal());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FoodResult | null>(null);
  const [mode, setMode] = useState<'search' | 'quick'>('search');
  const abort = useRef<AbortController | null>(null);

  // Debounced USDA search
  useEffect(() => {
    if (query.trim().length < 2) return setResults([]);
    const id = setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      setSearching(true);
      try {
        setResults(await searchFoods(query.trim(), abort.current.signal));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') Alert.alert('Search failed', String(e));
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [query]);

  // Barcode results from the scanner screen
  useEffect(
    () =>
      onBarcode(async (code) => {
        setSearching(true);
        const food = await lookupBarcode(code).catch(() => null);
        setSearching(false);
        if (food) setSelected(food);
        else Alert.alert('Not found', `No nutrition info for barcode ${code}. Try searching by name.`);
      }),
    [],
  );

  async function save(row: FoodRow) {
    const { error } = await supabase.from('food_entries').insert({ ...row, meal, eaten_at: eatenAt(params.date) });
    if (error) return Alert.alert('Error', error.message);
    router.back();
  }

  if (selected) return <AmountPicker food={selected} meal={meal} onBack={() => setSelected(null)} onSave={save} />;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: 16, gap: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {MEALS.map((m) => (
            <Chip key={m} label={m} active={meal === m} onPress={() => setMeal(m)} color={accent.food} />
          ))}
        </ScrollView>
        <Row>
          <Chip label="Search" active={mode === 'search'} onPress={() => setMode('search')} />
          <Chip label="Quick add" active={mode === 'quick'} onPress={() => setMode('quick')} />
          <View style={{ flex: 1 }} />
          <Button title="Scan barcode" variant="outline" onPress={() => router.push('/scan')} style={{ paddingVertical: 8 }} />
        </Row>
        {mode === 'search' ? (
          <Row>
            <Input placeholder="Search foods (e.g. greek yogurt)" value={query} onChangeText={setQuery} autoFocus autoCorrect={false} />
            {searching ? <ActivityIndicator /> : null}
          </Row>
        ) : null}
      </View>

      {mode === 'search' ? (
        <FlatList
          data={results}
          keyExtractor={(f) => f.source + f.externalId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const n = item.serving ? nutrientsFor(item, item.serving.grams) : nutrientsFor(item, 100);
            return (
              <Pressable onPress={() => setSelected(item)}>
                <Card style={{ paddingVertical: 12 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: '600' }}>{item.name}</Body>
                      <Body muted style={{ fontSize: 13 }}>
                        {[item.brand, item.serving?.label ?? '100 g'].filter(Boolean).join(' · ')}
                      </Body>
                    </View>
                    <Body style={{ fontWeight: '600' }}>{n.calories} kcal</Body>
                  </Row>
                </Card>
              </Pressable>
            );
          }}
        />
      ) : (
        <QuickAdd onSave={save} />
      )}
    </KeyboardAvoidingView>
  );
}

function AmountPicker({
  food,
  meal,
  onBack,
  onSave,
}: {
  food: FoodResult;
  meal: Meal;
  onBack: () => void;
  onSave: (row: FoodRow) => void;
}) {
  const t = useTheme();
  const [byServing, setByServing] = useState(!!food.serving);
  const [amount, setAmount] = useState(food.serving ? '1' : '100');
  const qty = parseFloat(amount) || 0;
  const grams = byServing && food.serving ? qty * food.serving.grams : qty;
  const n = nutrientsFor(food, grams);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card>
        <Title>{food.name}</Title>
        {food.brand ? <Body muted>{food.brand}</Body> : null}
        <Row>
          {food.serving ? (
            <Chip label={food.serving.label} active={byServing} onPress={() => { setByServing(true); setAmount('1'); }} color={accent.food} />
          ) : null}
          <Chip label="grams" active={!byServing} onPress={() => { setByServing(false); setAmount('100'); }} color={accent.food} />
        </Row>
        <Input label={byServing ? 'Servings' : 'Grams'} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      </Card>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          {(
            [
              ['Calories', n.calories, ''],
              ['Protein', n.protein, 'g'],
              ['Carbs', n.carbs, 'g'],
              ['Fat', n.fat, 'g'],
            ] as const
          ).map(([l, v, u]) => (
            <View key={l} style={{ alignItems: 'center' }}>
              <Label>{l}</Label>
              <Body style={{ fontWeight: '700', fontSize: 18 }}>
                {v}
                {u}
              </Body>
            </View>
          ))}
        </Row>
      </Card>
      <Button
        title={`Add to ${meal}`}
        color={accent.food}
        disabled={qty <= 0}
        onPress={() =>
          onSave({
            name: food.name,
            brand: food.brand,
            serving_desc: byServing && food.serving ? food.serving.label : `${Math.round(grams)} g`,
            servings: byServing ? qty : 1,
            calories: n.calories,
            protein_g: n.protein,
            carbs_g: n.carbs,
            fat_g: n.fat,
            source: food.source,
            external_id: food.externalId,
          })
        }
      />
      <Button title="Back to results" variant="outline" onPress={onBack} />
    </ScrollView>
  );
}

function QuickAdd({ onSave }: { onSave: (row: FoodRow) => void }) {
  const [name, setName] = useState('');
  const [cal, setCal] = useState('');
  const [p, setP] = useState('');
  const [c, setC] = useState('');
  const [f, setF] = useState('');
  const num = (s: string) => (s ? parseFloat(s) : undefined);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Input label="Name" placeholder="e.g. Homemade chili" value={name} onChangeText={setName} />
      <Input label="Calories" keyboardType="number-pad" value={cal} onChangeText={setCal} />
      <Row>
        <Input label="Protein g" keyboardType="decimal-pad" value={p} onChangeText={setP} />
        <Input label="Carbs g" keyboardType="decimal-pad" value={c} onChangeText={setC} />
        <Input label="Fat g" keyboardType="decimal-pad" value={f} onChangeText={setF} />
      </Row>
      <Button
        title="Add"
        color={accent.food}
        disabled={!name || !cal}
        onPress={() =>
          onSave({ name, servings: 1, calories: parseFloat(cal), protein_g: num(p), carbs_g: num(c), fat_g: num(f), source: 'manual' })
        }
      />
    </ScrollView>
  );
}
