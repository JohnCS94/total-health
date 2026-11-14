import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Body, Button, Card, Label, ProgressBar, Row, Title, accent, useTheme } from '@/components/ui';
import { healthAvailable, syncFromHealth } from '@/lib/healthkit';
import { useSettings } from '@/lib/settings';
import { MEALS, dayRange, localDate, supabase, type FoodEntry } from '@/lib/supabase';

/** Read-only food diary. Food is logged in Lose It and imported via Apple Health. */
export default function Food() {
  const t = useTheme();
  const { settings } = useSettings();
  const [day, setDay] = useState(new Date());
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

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

  async function onRefresh() {
    setRefreshing(true);
    try {
      if (healthAvailable()) await syncFromHealth(7);
    } catch (e) {
      console.warn(e);
    }
    await load();
    setRefreshing(false);
  }

  const shift = (n: number) => setDay((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  const isToday = localDate(day) === localDate();
  const total = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') =>
    Math.round(entries.reduce((a, e) => a + Number(e[k] ?? 0), 0));
  const goal = settings?.calorie_goal ?? 2200;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Button title="‹" variant="outline" onPress={() => shift(-1)} style={{ paddingVertical: 6 }} />
        <Title>{isToday ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Title>
        <Button title="›" variant="outline" onPress={() => shift(1)} disabled={isToday} style={{ paddingVertical: 6 }} />
      </Row>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Stat label="Eaten" value={total('calories')} />
          <Stat label="Goal" value={goal} />
          <Stat label="Protein" value={total('protein_g')} unit="g" />
          <Stat label="Carbs" value={total('carbs_g')} unit="g" />
          <Stat label="Fat" value={total('fat_g')} unit="g" />
        </Row>
        <ProgressBar value={total('calories')} max={goal} color={accent.food} />
      </Card>

      {entries.length === 0 ? (
        <Card>
          <Body muted>Nothing logged{isToday ? ' yet today' : ''}. Log food in Lose It, then pull down to sync from Apple Health.</Body>
        </Card>
      ) : (
        MEALS.map((meal) => {
          const items = entries.filter((e) => e.meal === meal);
          if (!items.length) return null;
          const cals = Math.round(items.reduce((a, e) => a + Number(e.calories), 0));
          return (
            <Card key={meal}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Title>{meal[0].toUpperCase() + meal.slice(1)}</Title>
                <Body muted>{cals} kcal</Body>
              </Row>
              {items.map((e) => (
                <Row key={e.id} style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Body>{e.name}</Body>
                    <Body muted style={{ fontSize: 13 }}>
                      {[
                        new Date(e.eaten_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
                        e.protein_g != null ? `P ${Math.round(Number(e.protein_g))}g` : null,
                        e.carbs_g != null ? `C ${Math.round(Number(e.carbs_g))}g` : null,
                        e.fat_g != null ? `F ${Math.round(Number(e.fat_g))}g` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Body>
                  </View>
                  <Body>{Math.round(Number(e.calories))}</Body>
                </Row>
              ))}
            </Card>
          );
        })
      )}
      <Body muted style={{ textAlign: 'center', fontSize: 13 }}>
        Food is logged in Lose It and imported from Apple Health. Pull down to sync.
      </Body>
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
