import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Body, Button, Card, Label, Row, Title, accent, useTheme } from '@/components/ui';
import { useSettings } from '@/lib/settings';
import { MEALS, dayRange, localDate, supabase, type FoodEntry } from '@/lib/supabase';

export default function Food() {
  const t = useTheme();
  const { settings } = useSettings();
  const [day, setDay] = useState(new Date());
  const [entries, setEntries] = useState<FoodEntry[]>([]);

  const load = useCallback(async () => {
    const { start, end } = dayRange(day);
    const { data } = await supabase
      .from('food_entries')
      .select('*')
      .gte('eaten_at', start)
      .lt('eaten_at', end)
      .order('eaten_at');
    setEntries((data as FoodEntry[]) ?? []);
  }, [day]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const shift = (n: number) => setDay((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  const isToday = localDate(day) === localDate();
  const total = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') =>
    Math.round(entries.reduce((a, e) => a + Number(e[k] ?? 0), 0));

  function confirmDelete(e: FoodEntry) {
    Alert.alert('Delete entry?', e.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('food_entries').delete().eq('id', e.id);
          load();
        },
      },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Button title="‹" variant="outline" onPress={() => shift(-1)} style={{ paddingVertical: 6 }} />
        <Title>{isToday ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Title>
        <Button title="›" variant="outline" onPress={() => shift(1)} disabled={isToday} style={{ paddingVertical: 6 }} />
      </Row>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Stat label="Eaten" value={total('calories')} />
          <Stat label="Goal" value={settings?.calorie_goal ?? 2200} />
          <Stat label="Protein" value={total('protein_g')} unit="g" />
          <Stat label="Carbs" value={total('carbs_g')} unit="g" />
          <Stat label="Fat" value={total('fat_g')} unit="g" />
        </Row>
      </Card>

      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal);
        const cals = Math.round(items.reduce((a, e) => a + Number(e.calories), 0));
        return (
          <Card key={meal}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Title>{meal[0].toUpperCase() + meal.slice(1)}</Title>
              <Body muted>{cals} kcal</Body>
            </Row>
            {items.map((e) => (
              <Pressable key={e.id} onLongPress={() => confirmDelete(e)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Body>{e.name}</Body>
                    <Body muted style={{ fontSize: 13 }}>
                      {[e.brand, e.serving_desc && `${Number(e.servings)} × ${e.serving_desc}`].filter(Boolean).join(' · ')}
                    </Body>
                  </View>
                  <Body>{Math.round(Number(e.calories))}</Body>
                </Row>
              </Pressable>
            ))}
            <Button
              title={`+ Add to ${meal}`}
              variant="outline"
              color={accent.food}
              onPress={() => router.push({ pathname: '/food-search', params: { meal, date: localDate(day) } })}
            />
          </Card>
        );
      })}
      <Body muted style={{ textAlign: 'center', fontSize: 13 }}>Long-press an item to delete it.</Body>
    </ScrollView>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Label>{label}</Label>
      <Body style={{ fontWeight: '700', fontSize: 17 }}>
        {value}
        {unit ?? ''}
      </Body>
    </View>
  );
}
