import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, View } from 'react-native';

import { Body, Button, Card, Chip, Input, ProgressBar, Row, Title, accent, useTheme } from '@/components/ui';
import { useUnits } from '@/lib/settings';
import { healthAvailable, saveWaterToHealth, saveWeightToHealth } from '@/lib/healthkit';
import { scoreLabel } from '@/lib/sleepScore';
import { dayRange, localDate, supabase } from '@/lib/supabase';
import { distanceLabel, mlTo, round, toKg, toKm, toMl, waterLabel, waterPresets, weightLabel } from '@/lib/units';

const ACTIVITIES = ['running', 'walking', 'cycling', 'strength', 'hiit', 'yoga', 'swimming', 'hiking', 'other'];

export default function Log() {
  const t = useTheme();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <WeightCard />
        <WaterCard />
        <SleepCard />
        <WorkoutCard />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Best-effort write to Apple Health; never blocks saving to Supabase. */
async function tryHealth<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (!healthAvailable()) return undefined;
  try {
    return await fn();
  } catch (e) {
    console.warn('Health write failed', e);
    return undefined;
  }
}

function WeightCard() {
  const units = useUnits();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const v = parseFloat(value);
    if (!v) return;
    setBusy(true);
    const kg = round(toKg(v, units), 2);
    const now = new Date();
    const healthkit_uuid = await tryHealth(() => saveWeightToHealth(kg, now));
    const { error } = await supabase
      .from('weight_entries')
      .insert({ weight_kg: kg, measured_at: now.toISOString(), healthkit_uuid });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    setValue('');
    Alert.alert('Saved', `${v} ${weightLabel(units)}`);
  }

  return (
    <Card>
      <Title color={accent.weight}>Weight</Title>
      <Row>
        <Input placeholder={`Today's weight (${weightLabel(units)})`} keyboardType="decimal-pad" value={value} onChangeText={setValue} />
        <Button title="Save" color={accent.weight} onPress={save} loading={busy} />
      </Row>
    </Card>
  );
}

function WaterCard() {
  const units = useUnits();
  const [todayMl, setTodayMl] = useState(0);
  const [custom, setCustom] = useState('');

  const load = useCallback(async () => {
    const { start, end } = dayRange();
    const { data } = await supabase.from('water_entries').select('amount_ml').gte('logged_at', start).lt('logged_at', end);
    setTodayMl((data ?? []).reduce((a, r) => a + r.amount_ml, 0));
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function add(amount: number) {
    const ml = Math.round(toMl(amount, units));
    if (ml <= 0) return;
    setTodayMl((x) => x + ml); // optimistic
    const now = new Date();
    const healthkit_uuid = await tryHealth(() => saveWaterToHealth(ml, now));
    const { error } = await supabase.from('water_entries').insert({ amount_ml: ml, logged_at: now.toISOString(), healthkit_uuid });
    if (error) Alert.alert('Error', error.message);
    load();
  }

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title color={accent.water}>Water</Title>
        <Body muted>
          Today: {round(mlTo(todayMl, units), 0)} {waterLabel(units)}
        </Body>
      </Row>
      <Row>
        {waterPresets(units).map((p) => (
          <Button key={p} title={`+${p}`} variant="outline" color={accent.water} onPress={() => add(p)} style={{ flex: 1, paddingHorizontal: 4 }} />
        ))}
      </Row>
      <Row>
        <Input placeholder={`Custom (${waterLabel(units)})`} keyboardType="decimal-pad" value={custom} onChangeText={setCustom} />
        <Button
          title="Add"
          color={accent.water}
          onPress={() => {
            add(parseFloat(custom) || 0);
            setCustom('');
          }}
        />
      </Row>
    </Card>
  );
}

type SleepRow = {
  hours: number | null;
  score: number | null;
  bedtime: string | null;
  wake_time: string | null;
  awake_min: number | null;
  wake_count: number | null;
  score_duration: number | null;
  score_consistency: number | null;
  score_interruptions: number | null;
  source: string;
};

function SleepCard() {
  const [row, setRow] = useState<SleepRow | null>(null);
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('sleep_entries')
      .select('hours, score, bedtime, wake_time, awake_min, wake_count, score_duration, score_consistency, score_interruptions, source')
      .eq('sleep_date', localDate())
      .maybeSingle();
    setRow(data as SleepRow | null);
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  // Manual hours are only a fallback for nights nothing tracked (no score without timing data).
  async function saveHours() {
    const h = parseFloat(hours);
    if (!h) return;
    setBusy(true);
    const { error } = await supabase.from('sleep_entries').upsert({ sleep_date: localDate(), hours: h }, { onConflict: 'sleep_date' });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    setHours('');
    load();
  }

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '–');

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title color={accent.sleep}>Last night's sleep</Title>
        {row?.score != null ? (
          <Body style={{ fontWeight: '700' }}>
            {row.score} · {scoreLabel(row.score)}
          </Body>
        ) : null}
      </Row>
      {row?.score != null ? (
        <>
          <Body muted>
            {time(row.bedtime)} → {time(row.wake_time)} · {Number(row.hours)} h asleep · {Math.round(Number(row.awake_min ?? 0))} min awake ·{' '}
            {row.wake_count ?? 0} wake-ups
          </Body>
          <ScoreBar label="Duration" value={Number(row.score_duration)} max={50} />
          <ScoreBar label="Bedtime consistency" value={Number(row.score_consistency)} max={30} />
          <ScoreBar label="Interruptions" value={Number(row.score_interruptions)} max={20} />
        </>
      ) : row?.hours != null ? (
        <Body muted>{Number(row.hours)} h (entered manually, so no score)</Body>
      ) : (
        <Body muted>No sleep from Apple Health yet for last night. Pull to refresh on Today to sync.</Body>
      )}
      {row?.source !== 'healthkit' ? (
        <Row>
          <Input placeholder="Hours (only if not tracked)" keyboardType="decimal-pad" value={hours} onChangeText={setHours} />
          <Button title="Save" color={accent.sleep} onPress={saveHours} loading={busy} />
        </Row>
      ) : null}
    </Card>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <View style={{ gap: 4 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Body style={{ fontSize: 13 }}>{label}</Body>
        <Body muted style={{ fontSize: 13 }}>
          {Math.round(value)} / {max}
        </Body>
      </Row>
      <ProgressBar value={value} max={max} color={accent.sleep} />
    </View>
  );
}

function WorkoutCard() {
  const units = useUnits();
  const [type, setType] = useState('running');
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [calories, setCalories] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const hasDistance = ['running', 'walking', 'cycling', 'swimming', 'hiking'].includes(type);

  async function save() {
    if (!duration) return Alert.alert('Duration required');
    setBusy(true);
    const { error } = await supabase.from('workouts').insert({
      activity_type: type,
      duration_min: parseFloat(duration),
      distance_km: hasDistance && distance ? round(toKm(parseFloat(distance), units), 2) : null,
      calories: calories ? parseFloat(calories) : null,
      notes: notes || null,
    });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    setDuration('');
    setDistance('');
    setCalories('');
    setNotes('');
    Alert.alert('Workout saved');
  }

  return (
    <Card>
      <Title color={accent.workout}>Workout</Title>
      <Body muted style={{ fontSize: 13 }}>
        Workouts recorded on Apple Watch / Fitness import automatically. Log anything else here.
      </Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ACTIVITIES.map((a) => (
          <Chip key={a} label={a} active={type === a} onPress={() => setType(a)} color={accent.workout} />
        ))}
      </View>
      <Row>
        <Input label="Minutes" keyboardType="decimal-pad" value={duration} onChangeText={setDuration} />
        {hasDistance ? (
          <Input label={`Distance (${distanceLabel(units)})`} keyboardType="decimal-pad" value={distance} onChangeText={setDistance} />
        ) : null}
        <Input label="Calories" keyboardType="number-pad" value={calories} onChangeText={setCalories} />
      </Row>
      <Input label="Notes" placeholder="e.g. 5x5 squat 225" value={notes} onChangeText={setNotes} />
      <Button title="Save workout" color={accent.workout} onPress={save} loading={busy} />
    </Card>
  );
}
