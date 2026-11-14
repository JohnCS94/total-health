import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { BigNumber, Body, Button, Card, ProgressBar, Row, Title, accent, useTheme } from '@/components/ui';
import { useSettings, useUnits } from '@/lib/settings';
import { healthAvailable, syncFromHealth } from '@/lib/healthkit';
import { dayRange, localDate, supabase } from '@/lib/supabase';
import { kgTo, kmTo, distanceLabel, mlTo, round, waterLabel, weightLabel } from '@/lib/units';

type Summary = {
  calories: number;
  protein: number;
  waterMl: number;
  weightKg: number | null;
  weightDate: string | null;
  weightWeekAgoKg: number | null;
  sleep: { hours: number | null; score: number | null; sleep_date: string } | null;
  workouts: { activity_type: string; duration_min: number; distance_km: number | null }[];
  lifts: { title: string | null; duration_min: number | null; set_count: number | null; volume_kg: number | null }[];
};

export default function Today() {
  const t = useTheme();
  const units = useUnits();
  const { settings } = useSettings();
  const [s, setS] = useState<Summary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { start, end } = dayRange();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [food, water, weight, weightOld, sleep, workouts, lifts] = await Promise.all([
      supabase.from('food_entries').select('calories, protein_g').gte('eaten_at', start).lt('eaten_at', end),
      supabase.from('water_entries').select('amount_ml').gte('logged_at', start).lt('logged_at', end),
      supabase.from('weight_entries').select('weight_kg, measured_at').order('measured_at', { ascending: false }).limit(1),
      supabase
        .from('weight_entries')
        .select('weight_kg')
        .lte('measured_at', weekAgo.toISOString())
        .order('measured_at', { ascending: false })
        .limit(1),
      supabase.from('sleep_entries').select('hours, score, sleep_date').order('sleep_date', { ascending: false }).limit(1),
      supabase
        .from('workouts')
        .select('activity_type, duration_min, distance_km, started_at')
        .gte('started_at', start)
        .lt('started_at', end),
      supabase
        .from('hevy_workouts')
        .select('title, duration_min, set_count, volume_kg, started_at, ended_at')
        .gte('started_at', start)
        .lt('started_at', end),
    ]);

    setS({
      calories: (food.data ?? []).reduce((a, r) => a + Number(r.calories), 0),
      protein: (food.data ?? []).reduce((a, r) => a + Number(r.protein_g ?? 0), 0),
      waterMl: (water.data ?? []).reduce((a, r) => a + r.amount_ml, 0),
      weightKg: weight.data?.[0] ? Number(weight.data[0].weight_kg) : null,
      weightDate: weight.data?.[0]?.measured_at ?? null,
      weightWeekAgoKg: weightOld.data?.[0] ? Number(weightOld.data[0].weight_kg) : null,
      sleep: sleep.data?.[0] ?? null,
      // Hide Apple Health strength entries that are just Hevy's copy of a session.
      workouts: (workouts.data ?? []).filter(
        (w) =>
          w.activity_type !== 'strength' ||
          !(lifts.data ?? []).some((h) => {
            const a0 = new Date(w.started_at).getTime();
            const a1 = a0 + Number(w.duration_min) * 60_000;
            const b0 = new Date(h.started_at).getTime();
            const b1 = h.ended_at ? new Date(h.ended_at).getTime() : b0 + Number(h.duration_min ?? 0) * 60_000;
            return a0 < b1 && b0 < a1;
          }),
      ),
      lifts: lifts.data ?? [],
    });
  }, []);

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

  const calGoal = settings?.calorie_goal ?? 2200;
  const waterGoal = settings?.water_goal_ml ?? 2500;
  const lastNight = s?.sleep && s.sleep.sleep_date === localDate() ? s.sleep : null;
  const weightDelta = s?.weightKg != null && s.weightWeekAgoKg != null ? s.weightKg - s.weightWeekAgoKg : null;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Title color={accent.food}>Calories</Title>
          <Body muted>Goal {calGoal}</Body>
        </Row>
        <BigNumber value={String(Math.round(s?.calories ?? 0))} unit={`kcal · ${Math.round(s?.protein ?? 0)} g protein`} />
        <ProgressBar value={s?.calories ?? 0} max={calGoal} color={accent.food} />
        <Body muted>{Math.max(0, Math.round(calGoal - (s?.calories ?? 0)))} kcal remaining</Body>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Title color={accent.water}>Water</Title>
          <Body muted>
            Goal {round(mlTo(waterGoal, units), 0)} {waterLabel(units)}
          </Body>
        </Row>
        <BigNumber value={String(round(mlTo(s?.waterMl ?? 0, units), 0))} unit={waterLabel(units)} />
        <ProgressBar value={s?.waterMl ?? 0} max={waterGoal} color={accent.water} />
      </Card>

      <Row style={{ alignItems: 'stretch' }}>
        <Card style={{ flex: 1 }}>
          <Title color={accent.weight}>Weight</Title>
          <BigNumber value={s?.weightKg != null ? String(round(kgTo(s.weightKg, units))) : '—'} unit={weightLabel(units)} />
          {weightDelta != null ? (
            <Body muted>
              {weightDelta > 0 ? '+' : ''}
              {round(kgTo(weightDelta, units))} {weightLabel(units)} vs last week
            </Body>
          ) : null}
        </Card>
        <Card style={{ flex: 1 }}>
          <Title color={accent.sleep}>Sleep</Title>
          <BigNumber value={lastNight?.hours != null ? String(round(Number(lastNight.hours))) : '—'} unit="h" />
          <Body muted>{lastNight?.score != null ? `Score ${lastNight.score}` : 'No score yet'}</Body>
        </Card>
      </Row>

      <Card>
        <Title color={accent.workout}>Workouts today</Title>
        {s?.lifts.map((h, i) => (
          <Body key={`h${i}`}>
            <Body style={{ fontWeight: '600' }}>{h.title ?? 'Lifting'}</Body> · {Math.round(Number(h.duration_min ?? 0))} min · {h.set_count ?? 0} sets
            {h.volume_kg ? ` · ${Math.round(kgTo(Number(h.volume_kg), units)).toLocaleString()} ${weightLabel(units)}` : ''}
          </Body>
        ))}
        {s?.workouts.length ? (
          s.workouts.map((w, i) => (
            <Body key={i}>
              <Body style={{ textTransform: 'capitalize', fontWeight: '600' }}>{w.activity_type}</Body> · {Math.round(w.duration_min)} min
              {w.distance_km ? ` · ${round(kmTo(Number(w.distance_km), units), 2)} ${distanceLabel(units)}` : ''}
            </Body>
          ))
        ) : s?.lifts.length ? null : (
          <Body muted>Nothing logged yet.</Body>
        )}
      </Card>

      <View style={{ height: 8 }} />
      <Button title="Log food" color={accent.food} onPress={() => router.push('/food-search')} />
    </ScrollView>
  );
}
